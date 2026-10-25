import { env } from "cloudflare:test";
import { addDays, localDate, localTime, purgeDeletedUsers, type Profile } from "@quemo/core";
import { connect, fakeAuth, TEST_USER, testContext, type Caller } from "@quemo/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer, macroSplit, missingMeals, normalizePortion, portionText, type Env } from "../src/server";

const TZ = "Europe/Berlin";
const USER_TABLES = ["meal_items", "meals", "foods", "water_logs", "nutrition_goals", "weights"];

let n = 0;
async function newUser(patch: Partial<Profile> = {}): Promise<{ mcp: Caller; userId: string }> {
  const userId = `food-user-${++n}-${crypto.randomUUID()}`;
  const ctx = testContext<Env>({ DB: env.DB, PUBLIC_URL: "http://localhost:8791" }, { ...TEST_USER, ...patch, id: userId });
  return { mcp: await connect(buildServer(ctx)), userId };
}

const today = () => localDate(TZ);

const wrap = { name: "Chicken wrap", quantity: 1, unit: "piece", calories: 520, protein_g: 35, carbs_g: 48, fat_g: 20, fiber_g: 4, sugar_g: 5, sodium_mg: 950, estimated: true };
const cola = { name: "Cola", quantity: 330, unit: "ml", calories: 139, carbs_g: 35, sugar_g: 35, sodium_mg: 10 };

describe("unit helpers", () => {
  it("normalizes portions to grams / ml and renders them in the user's units", () => {
    expect(normalizePortion(1.5, "kg")).toEqual({ quantity: 1500, unit: "g" });
    expect(normalizePortion(1, "l")).toEqual({ quantity: 1000, unit: "ml" });
    expect(normalizePortion(2, "piece")).toEqual({ quantity: 2, unit: "piece" });
    expect(normalizePortion(4, "oz").quantity).toBeCloseTo(113.4, 1);
    expect(portionText(150, "g", "imperial")).toBe("5.3 oz");
    expect(portionText(150, "g", "metric")).toBe("150 g");
    expect(portionText(330, "ml", "imperial")).toBe("11.2 fl oz");
  });

  it("computes the macro split by calories", () => {
    expect(macroSplit({ protein_g: 25, carbs_g: 50, fat_g: 0 })).toEqual({ protein_pct: 33, carbs_pct: 67, fat_pct: 0 });
    expect(macroSplit({ protein_g: 0, carbs_g: 0, fat_g: 0 })).toBeNull();
  });

  it("knows which meals are overdue at a given time", () => {
    expect(missingMeals([], "09:00")).toEqual([]);
    expect(missingMeals([], "11:00")).toEqual(["breakfast"]);
    expect(missingMeals(["breakfast"], "15:30")).toEqual(["lunch"]);
    expect(missingMeals(["breakfast", "lunch"], "21:15")).toEqual(["dinner"]);
    expect(missingMeals(["snack"], "22:00")).toEqual(["breakfast", "lunch", "dinner"]);
  });
});

describe("meals", () => {
  let mcp: Caller;
  beforeEach(async () => ({ mcp } = await newUser()));

  it("logs a meal with items in one call and sums totals", async () => {
    const meal = await mcp.call("log_meal", { meal_type: "lunch", place: "office", mood: 4, energy: 3, items: [wrap, cola] });
    expect(meal).toMatchObject({ meal_type: "lunch", date: today(), place: "office", mood: 4, energy: 3, has_estimates: true });
    expect(meal.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
    expect(meal.totals).toEqual({ calories: 659, protein_g: 35, carbs_g: 83, fat_g: 20, fiber_g: 4, sugar_g: 40, sodium_mg: 960 });
    expect(meal.items).toHaveLength(2);
    expect(meal.items[0]).toMatchObject({ name: "Chicken wrap", estimated: true, portion: "1 piece" });
    expect(meal.items[1]).toMatchObject({ name: "Cola", estimated: false, protein_g: null, portion: "330 ml" });

    const text = await mcp.text("log_meal", { meal_type: "snack", items: [{ name: "Apple", calories: 95, estimated: true }] });
    expect(text).toMatch(/^Logged snack: 95 kcal · 0 g protein \(estimated\)\. Today: 754 kcal\./);
  });

  it("adds, updates and deletes items and meals", async () => {
    const meal = await mcp.call("log_meal", { meal_type: "breakfast", date: addDays(today(), -1), time: "08:15", items: [{ name: "Oatmeal", quantity: 60, unit: "g", calories: 230, protein_g: 8 }] });
    const added = await mcp.call("add_food_items", { meal_id: meal.id, items: [{ name: "Banana", quantity: 1, unit: "piece", calories: 105, protein_g: 1.3, estimated: true }] });
    expect(added.totals.calories).toBe(335);
    expect(added.items.map((i: any) => i.name)).toEqual(["Oatmeal", "Banana"]);

    const oat = added.items[0];
    const updated = await mcp.call("update_meal_item", { id: oat.id, quantity: 80, calories: 307 });
    expect(updated.items[0]).toMatchObject({ quantity: 80, unit: "g", calories: 307 });
    expect(updated.totals.calories).toBe(412);

    const removed = await mcp.call("delete_meal_item", { id: added.items[1].id });
    expect(removed.meal.totals.calories).toBe(307);

    const renamed = await mcp.call("update_meal", { id: meal.id, name: "Porridge", hunger: 5 });
    expect(renamed).toMatchObject({ name: "Porridge", hunger: 5, time: "08:15" });
    expect((await mcp.call("get_meal", { id: meal.id })).items).toHaveLength(1);

    await mcp.call("delete_meal", { id: meal.id });
    expect(await mcp.callError("get_meal", { id: meal.id })).toMatch(/not found/);
    expect(await mcp.callError("delete_meal", { id: meal.id })).toMatch(/not found/);
    expect(await mcp.callError("add_food_items", { meal_id: meal.id, items: [{ name: "X" }] })).toMatch(/not found/);
  });

  it("lists meals by period, type and text", async () => {
    await mcp.call("log_meal", { meal_type: "lunch", place: "Cafe Luna", items: [wrap] });
    await mcp.call("log_meal", { meal_type: "dinner", date: addDays(today(), -2), items: [{ name: "Spaghetti bolognese", calories: 700 }] });
    await mcp.call("log_meal", { meal_type: "dinner", date: addDays(today(), -40), items: [{ name: "Pizza", calories: 900 }] });

    const week = await mcp.call("list_meals");
    expect(week.count).toBe(2);
    expect(week.totals.calories).toBe(1220);
    expect(week.meals[0].meal_type).toBe("lunch"); // newest first
    expect((await mcp.call("list_meals", { meal_type: "dinner", period: "last_90_days" })).count).toBe(2);
    expect((await mcp.call("list_meals", { search: "bolognese" })).meals[0].items[0].name).toBe("Spaghetti bolognese");
    expect((await mcp.call("list_meals", { search: "luna" })).count).toBe(1);
  });

  it("copies a meal from yesterday or by id", async () => {
    const y = addDays(today(), -1);
    const src = await mcp.call("log_meal", { meal_type: "breakfast", date: y, time: "07:30", note: "rushed", items: [{ name: "Greek yogurt", calories: 150, protein_g: 15 }, { name: "Granola", calories: 200, protein_g: 5 }] });

    const copy = await mcp.call("copy_meal", { meal_type: "breakfast" });
    expect(copy).toMatchObject({ meal_type: "breakfast", date: today(), note: null });
    expect(copy.id).not.toBe(src.id);
    expect(copy.totals).toMatchObject({ calories: 350, protein_g: 20 });
    expect(copy.items.map((i: any) => i.name)).toEqual(["Greek yogurt", "Granola"]);
    expect(new Set(copy.items.map((i: any) => i.id)).size).toBe(2);

    const asSnack = await mcp.call("copy_meal", { meal_id: src.id, to_date: addDays(today(), -3), to_meal_type: "snack", time: "16:00" });
    expect(asSnack).toMatchObject({ meal_type: "snack", date: addDays(today(), -3), time: "16:00" });

    expect(await mcp.callError("copy_meal", { meal_type: "dinner" })).toMatch(/No dinner logged/);
    expect(await mcp.callError("copy_meal", {})).toMatch(/meal_id/);
  });

  it("rejects invalid input", async () => {
    await expect(mcp.call("log_meal", { meal_type: "brunch", items: [{ name: "Eggs" }] })).rejects.toThrow();
    await expect(mcp.call("log_meal", { meal_type: "lunch", items: [] })).rejects.toThrow();
    await expect(mcp.call("log_meal", { meal_type: "lunch", date: "25/10/2026", items: [{ name: "Eggs" }] })).rejects.toThrow();
    await expect(mcp.call("log_meal", { meal_type: "lunch", time: "25:00", items: [{ name: "Eggs" }] })).rejects.toThrow();
    await expect(mcp.call("log_meal", { meal_type: "lunch", items: [{ name: "Eggs", calories: -5 }] })).rejects.toThrow();
    await expect(mcp.call("log_meal", { meal_type: "lunch", mood: 6, items: [{ name: "Eggs" }] })).rejects.toThrow();
    expect(await mcp.callError("log_meal", { meal_type: "lunch", items: [{ quantity: 2 }] })).toMatch(/needs a name/);
    await expect(mcp.call("log_water", { amount: 0 })).rejects.toThrow();
    await expect(mcp.call("set_nutrition_goals", { calories: -100 })).rejects.toThrow();
    // nothing half-written
    expect((await mcp.call("list_meals")).count).toBe(0);
  });
});

describe("food library", () => {
  it("computes macros from a saved food and servings", async () => {
    const { mcp } = await newUser();
    const saved = await mcp.call("save_food", { name: "Protein shake", serving_qty: 1, serving_unit: "scoop", calories: 120, protein_g: 24, carbs_g: 3, fat_g: 1.5, sodium_mg: 150 });
    expect(saved).toMatchObject({ name: "Protein shake", serving: "1 scoop", per_serving: { calories: 120, protein_g: 24 } });
    await mcp.call("save_food", { name: "Rice", serving_qty: 100, serving_unit: "g", calories: 130, protein_g: 2.7, carbs_g: 28, fat_g: 0.3 });

    const meal = await mcp.call("log_meal", {
      meal_type: "snack",
      items: [
        { food: "protein SHAKE", servings: 2 },
        { food: "Rice", quantity: 250, unit: "g" },
        { food: "Rice", calories: 100 }, // explicit values override the saved food
      ],
    });
    expect(meal.items[0]).toMatchObject({ name: "Protein shake", servings: 2, quantity: 2, unit: "scoop", calories: 240, protein_g: 48, carbs_g: 6, fat_g: 3, sodium_mg: 300, saved_food: true, estimated: false });
    expect(meal.items[1]).toMatchObject({ name: "Rice", servings: 2.5, quantity: 250, calories: 325, carbs_g: 70 });
    expect(meal.items[2]).toMatchObject({ servings: 1, quantity: 100, calories: 100, protein_g: 2.7 });

    const rescaled = await mcp.call("update_meal_item", { id: meal.items[0].id, servings: 1 });
    expect(rescaled.items[0]).toMatchObject({ servings: 1, calories: 120, protein_g: 24 });

    expect(await mcp.callError("log_meal", { meal_type: "lunch", items: [{ food: "Unicorn steak" }] })).toMatch(/No saved food named "Unicorn steak"/);
  });

  it("searches saved foods and logged items ranked by frequency", async () => {
    const { mcp } = await newUser();
    await mcp.call("save_food", { name: "Overnight oats", calories: 380, protein_g: 18, favorite: true });
    for (let i = 0; i < 3; i++) await mcp.call("log_meal", { meal_type: "snack", date: addDays(today(), -i), items: [{ name: "Espresso", quantity: 30, unit: "ml", calories: 2 }] });
    await mcp.call("log_meal", { meal_type: "lunch", items: [{ name: "Caesar salad", calories: 450 }, { name: "espresso", calories: 2 }] });
    await mcp.call("log_meal", { meal_type: "breakfast", items: [{ food: "Overnight oats" }] });

    const all = await mcp.call("search_foods");
    expect(all.saved_foods[0]).toMatchObject({ name: "Overnight oats", favorite: true, times_logged: 1 });
    expect(all.logged_items[0]).toMatchObject({ name: "Espresso", times_logged: 4, avg_calories: 2 });
    expect(all.logged_items.map((f: any) => f.name)).toEqual(expect.arrayContaining(["Caesar salad", "Overnight oats"]));

    const q = await mcp.call("search_foods", { query: "salad" });
    expect(q.saved_foods).toEqual([]);
    expect(q.logged_items).toEqual([expect.objectContaining({ name: "Caesar salad", times_logged: 1 })]);

    await mcp.call("delete_food", { name: "overnight oats" });
    expect((await mcp.call("search_foods")).saved_foods).toEqual([]);
    expect((await mcp.call("list_meals", { search: "oats" })).meals[0].items[0]).toMatchObject({ calories: 380, saved_food: false });
  });
});

describe("water, goals and the daily view", () => {
  it("converts water for imperial users and stores ml", async () => {
    const { mcp, userId } = await newUser({ units: "imperial" });
    await mcp.call("set_nutrition_goals", { water: 64 });
    const w = await mcp.call("log_water", { amount: 16 });
    expect(w).toMatchObject({ amount: 16, day_total: 16, goal: 64, unit: "fl oz" });
    await mcp.call("log_water", { amount: 1, unit: "cup" }); // 240 ml ≈ 8.1 fl oz
    const stored = await env.DB.prepare("SELECT SUM(amount_ml) AS ml FROM water_logs WHERE user_id = ?").bind(userId).first<number>("ml");
    expect(stored).toBeCloseTo(16 * 29.5735 + 240, 1);
    const day = await mcp.call("daily_summary");
    expect(day.water).toMatchObject({ total: 24.1, goal: 64, unit: "fl oz" });
    expect(day.remaining.water).toBe(39.9);
    expect(day.goals).toMatchObject({ water: 64, water_unit: "fl oz" });

    const meal = await mcp.call("log_meal", { meal_type: "lunch", items: [{ name: "Steak", quantity: 200, unit: "g", calories: 540 }] });
    expect(meal.items[0].portion).toBe("7.1 oz");

    const metric = await newUser();
    expect(await metric.mcp.call("log_water", { amount: 2, unit: "glass" })).toMatchObject({ amount: 500, unit: "ml" });
    await metric.mcp.call("log_water", { amount: 1.5, unit: "l", date: addDays(today(), -1) });
    const entries = (await metric.mcp.call("daily_summary")).water.entries;
    expect(entries).toHaveLength(1);
    await metric.mcp.call("delete_water", { id: entries[0].id });
    expect((await metric.mcp.call("daily_summary")).water.total).toBe(0);
    expect((await metric.mcp.call("daily_summary", { date: addDays(today(), -1) })).water.total).toBe(1500);
  });

  it("shows totals vs goals, remaining and macro split for a day", async () => {
    const { mcp } = await newUser();
    expect((await mcp.call("get_nutrition_goals")).goals).toBeNull();
    await mcp.call("set_nutrition_goals", { calories: 2000, protein_g: 120, carbs_g: 220, fat_g: 70, fiber_g: 30, sugar_max_g: 50, sodium_max_mg: 2300, water: 2500 });
    await mcp.call("set_nutrition_goals", { protein_g: 140 }); // partial update keeps the rest
    expect(await mcp.call("get_nutrition_goals")).toMatchObject({ calories: 2000, protein_g: 140, fat_g: 70, water: 2500, water_unit: "ml" });

    await mcp.call("log_meal", { meal_type: "breakfast", time: "08:00", items: [{ name: "Eggs & toast", calories: 400, protein_g: 25, carbs_g: 30, fat_g: 20, fiber_g: 3, sugar_g: 4, sodium_mg: 600 }] });
    await mcp.call("log_meal", { meal_type: "lunch", time: "12:30", items: [wrap, cola] });
    await mcp.call("log_water", { amount: 750 });

    const d = await mcp.call("daily_summary", { date: today() });
    expect(d.totals).toMatchObject({ calories: 1059, protein_g: 60, carbs_g: 113, fat_g: 40, fiber_g: 7, sugar_g: 44, sodium_mg: 1560 });
    expect(d.remaining).toEqual({ calories: 941, protein_g: 80, carbs_g: 107, fat_g: 30, fiber_g: 23, sugar_g_allowance: 6, sodium_mg_allowance: 740, water: 1750 });
    expect(d.percent_of_goal).toMatchObject({ calories: 53, protein_g: 43, water: 30 });
    expect(d.macro_split).toEqual({ protein_pct: 23, carbs_pct: 43, fat_pct: 34 });
    expect(d.meals.map((m: any) => m.meal_type)).toEqual(["breakfast", "lunch"]);
    expect(d.meals[1].totals.calories).toBe(659);

    await mcp.call("set_nutrition_goals", { sugar_max_g: 0 }); // 0 clears a goal
    const g = await mcp.call("get_nutrition_goals");
    expect(g.sugar_max_g).toBeNull();
    expect(g.calories).toBe(2000);
  });

  it("tracks weight with a trend in the user's units", async () => {
    const { mcp } = await newUser();
    await mcp.call("log_weight", { weight: 82, date: addDays(today(), -14) });
    await mcp.call("log_weight", { weight: 81.5, date: addDays(today(), -7) });
    const w = await mcp.call("log_weight", { weight: 81 });
    expect(w.trend).toMatchObject({ latest: 81, unit: "kg", change_30d: -1, per_week: -0.5, direction: "down", days_since_last: 0 });
    await mcp.call("log_weight", { weight: 80.8 }); // same day replaces
    expect((await mcp.call("weight_history")).entries).toHaveLength(3);
    expect(await mcp.callError("log_weight", { weight: 5 })).toMatch(/looks wrong/);

    const imperial = await newUser({ units: "imperial" });
    const lb = await imperial.mcp.call("log_weight", { weight: 180 });
    expect(lb).toMatchObject({ weight: 180, unit: "lb" });
  });
});

describe("follow-up", () => {
  it("nudges a brand-new user", async () => {
    const { mcp } = await newUser();
    const f = await mcp.call("follow_up");
    expect(f).toMatchObject({ today: today(), streak_days: 0, meals_logged: [] });
    expect(f.nudges.join(" ")).toMatch(/No meals logged today yet/);
    expect(f.nudges.join(" ")).toMatch(/No nutrition goals set yet/);
  });

  it("reports missing meals for the current time, remaining calories and streaks", async () => {
    const { mcp } = await newUser();
    await mcp.call("set_nutrition_goals", { calories: 2000, protein_g: 100 });
    // A 3-day streak (today, yesterday, the day before) and an older, separate day.
    await mcp.call("log_meal", { meal_type: "breakfast", time: "00:00", items: [{ name: "Toast", calories: 300, protein_g: 10 }] });
    await mcp.call("log_meal", { meal_type: "dinner", date: addDays(today(), -1), items: [{ name: "Curry", calories: 2100, protein_g: 110 }] });
    await mcp.call("log_meal", { meal_type: "dinner", date: addDays(today(), -2), items: [{ name: "Salad", calories: 1500, protein_g: 50 }] });
    await mcp.call("log_meal", { meal_type: "lunch", date: addDays(today(), -4), items: [{ name: "Soup", calories: 400 }] });

    const f = await mcp.call("follow_up");
    const expectedMissing = missingMeals(["breakfast"], localTime(TZ));
    expect(f.missing_meals).toEqual(expectedMissing);
    for (const m of expectedMissing) expect(f.nudges).toContain(`No ${m} logged yet today, did you have one?`);
    expect(f.streak_days).toBe(3);
    expect(f.totals.calories).toBe(300);
    expect(f.remaining).toMatchObject({ calories: 1700, protein_g: 90 });
    expect(f.nudges).toContain("1,700 kcal left for today.");
    expect(f.nudges).toContain("3-day logging streak, keep it going!");
    // last 7 complete days: 3 logged; only yesterday (2100 kcal, 110 g) hit both goals
    expect(f.last_7_days).toEqual({ days_logged: 3, calorie_hits: 1, protein_hits: 1, calorie_hit_rate: 33, protein_hit_rate: 33 });
    expect(f.nudges.join(" ")).toMatch(/on target on only 1 of 3 logged days/);
  });

  it("keeps a streak alive until today is over and spots patterns", async () => {
    const { mcp } = await newUser();
    for (let i = 1; i <= 4; i++)
      await mcp.call("log_meal", {
        meal_type: "snack",
        date: addDays(today(), -i),
        time: "23:15",
        items: [{ name: "Chips", calories: 1000, fiber_g: 2, sodium_mg: 2600 }],
      });
    await mcp.call("log_weight", { weight: 70, date: addDays(today(), -20) });
    await mcp.call("log_weight", { weight: 71, date: addDays(today(), -10) });
    const f = await mcp.call("follow_up");
    expect(f.streak_days).toBe(4);
    expect(f.patterns).toMatchObject({ late_night_days: 4, days_logged: 4 });
    expect(f.patterns.low_fiber_days).toHaveLength(4);
    expect(f.patterns.high_sodium_days).toHaveLength(4);
    const nudges = f.nudges.join(" ");
    expect(nudges).toMatch(/Late-night eating/);
    expect(nudges).toMatch(/Fiber was low on 4 of 4/);
    expect(nudges).toMatch(/Sodium went above 2,300 mg on 4 days/);
    expect(nudges).toMatch(/Last weigh-in was 10 days ago/);
    expect(f.weight_trend).toMatchObject({ latest: 71, direction: "up", change_30d: 1 });
  });
});

describe("reports", () => {
  it("generates an organized report with a printable link", async () => {
    const { mcp } = await newUser();
    await mcp.call("set_nutrition_goals", { calories: 2000, protein_g: 100, water: 2000 });
    await mcp.call("log_meal", { meal_type: "breakfast", time: "08:00", mood: 4, energy: 4, hunger: 3, items: [{ name: "Oatmeal", calories: 350, protein_g: 12, carbs_g: 60, fat_g: 6, fiber_g: 8 }] });
    await mcp.call("log_meal", { meal_type: "lunch", time: "12:30", mood: 3, energy: 2, hunger: 5, items: [wrap, cola] });
    await mcp.call("log_meal", { meal_type: "dinner", date: addDays(today(), -1), time: "19:00", items: [{ name: "Salmon & rice", calories: 1900, protein_g: 105, carbs_g: 180, fat_g: 60, fiber_g: 6 }] });
    await mcp.call("log_water", { amount: 1500 });
    await mcp.call("log_weight", { weight: 80, date: addDays(today(), -1) });

    const md = await mcp.text("generate_report", { period: "last_7_days" });
    for (const heading of [
      "# Nutrition Report",
      "## Daily averages vs goals",
      "## Macro split",
      "## Calories by day",
      "## Meals by type",
      "## Top foods",
      "## Highest-calorie meals",
      "## Hydration",
      "## Weight trend",
      "## Mood & energy",
      "## Patterns",
    ]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("Quemo Food · Last 7 days");
    expect(md).toMatch(/\*\*1,455 kcal\*\* \(goal 2,000\)/); // (1009 + 1900) / 2 rounded
    expect(md).toContain("**2 / 7**");
    expect(md).toMatch(/Calories on target \(±10%\) on 1 of 2 logged days/);
    expect(md).toMatch(/Best day: .*1,900 kcal/);
    expect(md).toMatch(/\| dinner \| Salmon & rice \| 1,900 \| 105 g \|/);
    expect(md).toMatch(/\| Chicken wrap \| 1 \| 520 \| 520 \|/);
    expect(md).toMatch(/\*\*Latest:\*\* 80 kg/);
    expect(md).toMatch(/http:\/\/localhost:8791\/reports\/[a-f0-9]{40}/);
  });

  it("compares with the previous period of equal length", async () => {
    const { mcp } = await newUser();
    await mcp.call("log_meal", { meal_type: "dinner", items: [{ name: "Pasta", calories: 2000, protein_g: 80 }] });
    await mcp.call("log_meal", { meal_type: "dinner", date: addDays(today(), -9), items: [{ name: "Soup", calories: 1000, protein_g: 40 }] });
    const md = await mcp.text("generate_report", { period: "last_7_days" });
    expect(md).toContain("Average calories ▲ 100% vs. the previous 7 days (2,000 kcal vs 1,000 kcal/day).");
    expect(md).toContain("Average protein ▲ 100% (80 g vs 40 g/day).");
    expect(md).toContain("▲ 100% vs prev.");
    // custom range lands only on the older meal
    const old = await mcp.text("generate_report", { period: "custom", from: addDays(today(), -9), to: addDays(today(), -9) });
    expect(old).toContain("**1,000 kcal**");
  });

  it("shows an empty message for every section when nothing is logged", async () => {
    const { mcp } = await newUser();
    const md = await mcp.text("generate_report", { period: "this_month" });
    expect(md).toContain("No meals logged in this period yet.");
    for (const msg of [
      "_No meals logged in this period._",
      "_No macro data logged yet._",
      "_No foods logged in this period._",
      "_No water logged in this period._",
      "_No weight entries in this period._",
      "_No mood, energy or hunger ratings logged",
      "_No notable patterns in this period._",
    ]) {
      expect(md).toContain(msg);
    }
  });
});

describe("isolation and lifecycle", () => {
  it("never shows one user's data to another", async () => {
    const a = await newUser();
    const b = await newUser();
    const meal = await a.mcp.call("log_meal", { meal_type: "dinner", items: [{ name: "Secret pie", calories: 600 }] });
    await a.mcp.call("save_food", { name: "Secret sauce", calories: 50 });
    await a.mcp.call("log_water", { amount: 500 });
    expect((await b.mcp.call("list_meals")).count).toBe(0);
    expect(await b.mcp.callError("get_meal", { id: meal.id })).toMatch(/not found/);
    expect(await b.mcp.callError("delete_meal", { id: meal.id })).toMatch(/not found/);
    expect(await b.mcp.callError("update_meal_item", { id: meal.items[0].id, calories: 1 })).toMatch(/not found/);
    expect(await b.mcp.callError("delete_meal_item", { id: meal.items[0].id })).toMatch(/not found/);
    expect(await b.mcp.callError("copy_meal", { meal_id: meal.id })).toMatch(/not found/);
    expect(await b.mcp.callError("add_food_items", { meal_id: meal.id, items: [{ name: "X" }] })).toMatch(/not found/);
    expect(await b.mcp.callError("log_meal", { meal_type: "lunch", items: [{ food: "Secret sauce" }] })).toMatch(/No saved food/);
    const search = await b.mcp.call("search_foods");
    expect(search).toEqual({ saved_foods: [], logged_items: [] });
    expect((await b.mcp.call("daily_summary")).water.total).toBe(0);
    expect((await a.mcp.call("get_meal", { id: meal.id })).totals.calories).toBe(600);
  });

  it("purges data of deleted accounts", async () => {
    const { mcp, userId } = await newUser();
    await mcp.call("log_meal", { meal_type: "lunch", items: [{ name: "Gone", calories: 1 }] });
    await mcp.call("save_food", { name: "Gone too", calories: 1 });
    await mcp.call("log_water", { amount: 100 });
    await mcp.call("set_nutrition_goals", { calories: 1800 });
    await mcp.call("log_weight", { weight: 70 });
    const removed = await purgeDeletedUsers({ DB: env.DB, AUTH: fakeAuth(TEST_USER, [userId]), PUBLIC_URL: "", AUTH_URL: "" }, USER_TABLES);
    expect(removed).toBe(1);
    for (const t of USER_TABLES) expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).bind(userId).first("n")).toBe(0);
    expect((await mcp.call("list_meals")).count).toBe(0);
  });

  it("validates profile updates", async () => {
    const { mcp } = await newUser();
    expect(await mcp.callError("update_profile", { timezone: "Mars/Olympus" })).toMatch(/Unknown time zone/);
    expect((await mcp.call("update_profile", { units: "imperial" })).units).toBe("imperial");
    expect(await mcp.call("log_water", { amount: 8 })).toMatchObject({ amount: 8, unit: "fl oz" });
  });
});

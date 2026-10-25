import {
  addDays,
  createToolServer,
  daysBetween,
  fail,
  id,
  localDate,
  localTime,
  ok,
  PERIODS,
  reportResult,
  resolvePeriod,
  round,
  zDate,
  zPeriodInput,
  zTime,
  type ToolContext,
  type ToolEnv,
  type Units,
} from "@quemo/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { buildReport } from "./report";

export type Env = ToolEnv;

// ---------- units ----------

export const ML_PER_FL_OZ = 29.5735;
export const G_PER_OZ = 28.349523125;
export const KG_PER_LB = 0.45359237;

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "drink"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/** Units accepted for food portions. Weights and volumes are normalized to g / ml when stored. */
export const PORTION_UNITS = ["g", "kg", "oz", "lb", "ml", "l", "fl_oz", "cup", "tbsp", "tsp", "piece", "slice", "serving", "portion", "bowl", "glass", "can", "bottle", "scoop", "handful"] as const;
const WATER_UNITS = ["ml", "l", "fl_oz", "cup", "glass", "bottle"] as const;

const TO_BASE: Record<string, { unit: "g" | "ml"; factor: number }> = {
  kg: { unit: "g", factor: 1000 },
  oz: { unit: "g", factor: G_PER_OZ },
  lb: { unit: "g", factor: KG_PER_LB * 1000 },
  l: { unit: "ml", factor: 1000 },
  fl_oz: { unit: "ml", factor: ML_PER_FL_OZ },
};

/** Normalizes kg/oz/lb to grams and l/fl oz to ml; other units are kept as given. */
export function normalizePortion(quantity: number | null | undefined, unit: string | null | undefined): { quantity: number | null; unit: string | null } {
  if (quantity === null || quantity === undefined) return { quantity: null, unit: unit ?? null };
  const conv = unit ? TO_BASE[unit] : undefined;
  return conv ? { quantity: round(quantity * conv.factor, 1), unit: conv.unit } : { quantity, unit: unit ?? null };
}

/** Human portion in the user's units, e.g. "150 g" or "5.3 oz". */
export function portionText(quantity: number | null, unit: string | null, units: Units): string | null {
  if (quantity === null) return unit;
  if (units === "imperial" && unit === "g") return `${round(quantity / G_PER_OZ, 1)} oz`;
  if (units === "imperial" && unit === "ml") return `${round(quantity / ML_PER_FL_OZ, 1)} fl oz`;
  return `${round(quantity, 1)} ${(unit ?? "").replace("_", " ")}`.trim();
}

export function waterToMl(amount: number, unit: (typeof WATER_UNITS)[number]): number {
  return amount * { ml: 1, l: 1000, fl_oz: ML_PER_FL_OZ, cup: 240, glass: 250, bottle: 500 }[unit];
}
export const waterOut = (ml: number | null | undefined, units: Units) => (units === "imperial" ? round((ml ?? 0) / ML_PER_FL_OZ, 1) : Math.round(ml ?? 0));
export const waterUnit = (units: Units) => (units === "imperial" ? "fl oz" : "ml");
export const waterText = (ml: number | null | undefined, units: Units) => `${fmt(waterOut(ml, units))} ${waterUnit(units)}`;

export const weightOut = (kg: number, units: Units) => (units === "imperial" ? round(kg / KG_PER_LB, 1) : round(kg, 1));
export const weightUnit = (units: Units) => (units === "imperial" ? "lb" : "kg");

export const fmt = (n: number) => new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n);

// ---------- nutrients ----------

export const NUTRIENTS = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_g", "sodium_mg"] as const;
export type Nutrient = (typeof NUTRIENTS)[number];
export type Totals = Record<Nutrient, number>;

const roundNutrient = (k: Nutrient, v: number) => (k === "calories" || k === "sodium_mg" ? Math.round(v) : round(v, 1));

export function sumTotals(rows: Partial<Record<Nutrient, number | null>>[]): Totals {
  const t = Object.fromEntries(NUTRIENTS.map((k) => [k, 0])) as Totals;
  for (const r of rows) for (const k of NUTRIENTS) t[k] += r[k] ?? 0;
  for (const k of NUTRIENTS) t[k] = roundNutrient(k, t[k]);
  return t;
}

/** Share of calories coming from protein / carbs / fat (4 / 4 / 9 kcal per gram). */
export function macroSplit(t: Pick<Totals, "protein_g" | "carbs_g" | "fat_g">) {
  const p = t.protein_g * 4;
  const c = t.carbs_g * 4;
  const f = t.fat_g * 9;
  const sum = p + c + f;
  if (!sum) return null;
  return { protein_pct: Math.round((p / sum) * 100), carbs_pct: Math.round((c / sum) * 100), fat_pct: Math.round((f / sum) * 100) };
}

const SUM_SQL = NUTRIENTS.map((k) => `COALESCE(SUM(i.${k}), 0) AS ${k}`).join(", ");

const nutrientFields = {
  calories: z.number().min(0).max(20000).optional().describe("kcal"),
  protein_g: z.number().min(0).max(2000).optional(),
  carbs_g: z.number().min(0).max(2000).optional(),
  fat_g: z.number().min(0).max(2000).optional(),
  fiber_g: z.number().min(0).max(500).optional(),
  sugar_g: z.number().min(0).max(2000).optional(),
  sodium_mg: z.number().min(0).max(100000).optional(),
};

const rating = z.number().int().min(1).max(5);
const mealType = z.enum(MEAL_TYPES);
const text = (max: number) => z.string().trim().max(max);

const itemInput = z.object({
  name: z.string().trim().min(1).max(120).optional().describe("What was eaten, e.g. 'Chicken wrap'. Optional when `food` names a saved food."),
  food: z.string().trim().min(1).max(120).optional().describe("Name of a saved food (see search_foods / save_food). Its per-serving nutrition × servings is used automatically."),
  servings: z.number().positive().max(100).optional().describe("Number of servings of the saved food (default 1)"),
  quantity: z.number().positive().max(100000).optional().describe("Amount eaten, in `unit`"),
  unit: z.enum(PORTION_UNITS).optional(),
  ...nutrientFields,
  estimated: z.boolean().default(false).describe("true when YOU estimated the nutrition rather than the user/label giving it"),
});
type ItemInput = z.infer<typeof itemInput>;

// ---------- rows ----------

export interface MealRow {
  id: string;
  meal_type: MealType;
  date: string;
  time: string;
  name: string | null;
  place: string | null;
  note: string | null;
  photo_description: string | null;
  mood: number | null;
  energy: number | null;
  hunger: number | null;
}

export interface ItemRow extends Record<Nutrient, number | null> {
  id: string;
  meal_id: string;
  food_id: string | null;
  name: string;
  quantity: number | null;
  unit: string | null;
  servings: number | null;
  estimated: number;
}

export interface FoodRow extends Record<Nutrient, number | null> {
  id: string;
  name: string;
  brand: string | null;
  serving_qty: number;
  serving_unit: string;
  favorite: number;
}

export interface GoalsRow {
  calories: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
  sugar_max_g: number | null;
  sodium_max_mg: number | null;
  water_ml: number | null;
}

const MEAL_COLS = "id, meal_type, date, time, name, place, note, photo_description, mood, energy, hunger";

/** Meal deadlines used by follow_up: after this local time a meal type counts as "not logged yet". */
export const MEAL_DEADLINES: Partial<Record<MealType, string>> = { breakfast: "10:30", lunch: "15:00", dinner: "21:00" };

export function missingMeals(logged: string[], time: string): MealType[] {
  return (Object.entries(MEAL_DEADLINES) as [MealType, string][]).filter(([t, by]) => time >= by && !logged.includes(t)).map(([t]) => t);
}

export function buildServer(ctx: ToolContext<Env>): McpServer {
  const { env, user } = ctx;
  const db = env.DB;
  const uid = user.id;
  const units = () => user.units;
  const today = () => localDate(user.timezone);
  const now = () => localTime(user.timezone);

  const server = createToolServer(ctx, {
    name: "quemo-food",
    instructions:
      "Quemo Food: food & nutrition tracker driven from chat. Log naturally: 'had a chicken wrap for lunch' → call log_meal right away with meal_type lunch and one item " +
      "whose calories/protein/carbs/fat/fiber/sugar/sodium YOU estimate (realistic, typical portion sizes; mark estimated: true). Don't ask the user for macros unless they want precision. " +
      "Split mixed meals into items (e.g. burger, fries, cola). Reuse saved foods (search_foods) by passing `food` + `servings` so macros are computed exactly. " +
      "Water goes in log_water, body weight in log_weight. Mood/energy/hunger (1-5) on meals are optional but help spot patterns. " +
      "daily_summary answers 'how am I doing today', follow_up gives a check-in, generate_report a full organized report. " +
      `Show water in ${user.units === "imperial" ? "fl oz" : "ml"} and weight in ${user.units === "imperial" ? "lb" : "kg"} (the user's units).`,
  });

  // ---------- helpers ----------

  const fmtItem = (i: ItemRow) => ({
    id: i.id,
    name: i.name,
    quantity: i.quantity,
    unit: i.unit,
    portion: portionText(i.quantity, i.unit, units()),
    ...(i.servings !== null ? { servings: i.servings } : {}),
    ...(Object.fromEntries(NUTRIENTS.map((k) => [k, i[k] === null ? null : roundNutrient(k, i[k]!)])) as Record<Nutrient, number | null>),
    estimated: !!i.estimated,
    saved_food: !!i.food_id,
  });

  async function itemsFor(mealIds: string[]): Promise<Map<string, ItemRow[]>> {
    const map = new Map<string, ItemRow[]>();
    if (!mealIds.length) return map;
    const { results } = await db
      .prepare("SELECT * FROM meal_items WHERE user_id = ?1 AND meal_id IN (SELECT value FROM json_each(?2)) ORDER BY position, created_at")
      .bind(uid, JSON.stringify(mealIds))
      .all<ItemRow>();
    for (const r of results) map.set(r.meal_id, [...(map.get(r.meal_id) ?? []), r]);
    return map;
  }

  const fmtMeal = (m: MealRow, items: ItemRow[]) => ({
    id: m.id,
    date: m.date,
    time: m.time,
    meal_type: m.meal_type,
    name: m.name,
    place: m.place,
    note: m.note,
    photo_description: m.photo_description,
    mood: m.mood,
    energy: m.energy,
    hunger: m.hunger,
    totals: sumTotals(items),
    has_estimates: items.some((i) => i.estimated),
    items: items.map(fmtItem),
  });

  const getMealRow = (mealId: string) => db.prepare(`SELECT ${MEAL_COLS} FROM meals WHERE id = ?1 AND user_id = ?2`).bind(mealId, uid).first<MealRow>();

  async function loadMeal(mealId: string) {
    const m = await getMealRow(mealId);
    if (!m) return null;
    return fmtMeal(m, (await itemsFor([m.id])).get(m.id) ?? []);
  }

  const findFood = (foodName: string) => db.prepare("SELECT * FROM foods WHERE user_id = ?1 AND name = ?2").bind(uid, foodName.trim()).first<FoodRow>();

  /** Turns item input into a row, resolving saved foods. Throws with a user-facing message. */
  async function resolveItem(a: ItemInput) {
    let food: FoodRow | null = null;
    if (a.food) {
      food = await findFood(a.food);
      if (!food) throw new Error(`No saved food named "${a.food}". Save it with save_food, or give the nutrition directly.`);
    }
    const itemName = a.name ?? food?.name;
    if (!itemName) throw new Error("Each item needs a name (or a saved `food`).");
    const portion = normalizePortion(a.quantity, a.unit);
    let servings: number | null = null;
    const nutrients = {} as Record<Nutrient, number | null>;
    if (food) {
      servings = a.servings ?? (portion.quantity !== null && portion.unit === food.serving_unit ? portion.quantity / food.serving_qty : 1);
      for (const k of NUTRIENTS) nutrients[k] = a[k] ?? (food[k] === null ? null : food[k]! * servings);
      if (portion.quantity === null) {
        portion.quantity = round(food.serving_qty * servings, 1);
        portion.unit = food.serving_unit;
      }
    } else {
      for (const k of NUTRIENTS) nutrients[k] = a[k] ?? null;
    }
    return { name: itemName, food_id: food?.id ?? null, servings: servings === null ? null : round(servings, 2), ...portion, ...nutrients, estimated: a.estimated };
  }

  async function insertItems(mealId: string, items: ItemInput[]) {
    const resolved = [];
    for (const it of items) resolved.push(await resolveItem(it));
    const start = await db.prepare("SELECT COALESCE(MAX(position) + 1, 0) AS p FROM meal_items WHERE meal_id = ?1").bind(mealId).first<number>("p");
    const t = Date.now();
    return resolved.map((r, i) =>
      db
        .prepare(
          `INSERT INTO meal_items (id, meal_id, user_id, food_id, name, quantity, unit, servings, ${NUTRIENTS.join(", ")}, estimated, position, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
        )
        .bind(id(), mealId, uid, r.food_id, r.name, r.quantity, r.unit, r.servings, ...NUTRIENTS.map((k) => r[k]), r.estimated ? 1 : 0, (start ?? 0) + i, t),
    );
  }

  async function dayLine(date: string): Promise<string> {
    const [t] = await dailyTotals(db, uid, date, date);
    const g = await getGoals(db, uid);
    const cal = t?.calories ?? 0;
    return g?.calories ? `${date === today() ? "Today" : date}: ${fmt(cal)} / ${fmt(g.calories)} kcal.` : `${date === today() ? "Today" : date}: ${fmt(cal)} kcal.`;
  }

  // ---------- meals ----------

  server.registerTool(
    "log_meal",
    {
      title: "Log meal",
      description:
        "Log a meal, snack or drink with its food items in ONE call. When the user doesn't give nutrition, ESTIMATE it yourself for every item " +
        "(calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg) from typical recipes and realistic portion sizes, and set estimated: true. " +
        "Items may reference a saved food by `food` + `servings` (macros computed automatically). Date defaults to today, time to now (user's time zone).",
      inputSchema: z.object({
        meal_type: mealType.describe("breakfast, lunch, dinner, snack or drink"),
        date: zDate.optional().describe("Defaults to today"),
        time: zTime.optional().describe("HH:MM local; defaults to now"),
        name: text(120).optional().describe("Optional meal name, e.g. 'Sunday brunch'"),
        place: text(120).optional().describe("Where, e.g. home, office, restaurant name"),
        note: text(1000).optional(),
        photo_description: text(1000).optional().describe("Short description of a photo the user shared"),
        mood: rating.optional().describe("1 (bad) - 5 (great)"),
        energy: rating.optional().describe("1 (drained) - 5 (energized)"),
        hunger: rating.optional().describe("Hunger before eating, 1 (not hungry) - 5 (starving)"),
        items: z.array(itemInput).min(1).max(50),
      }),
    },
    async (a) => {
      const mealId = id();
      try {
        const stmts = await insertItems(mealId, a.items);
        await db.batch([
          db
            .prepare(
              `INSERT INTO meals (id, user_id, meal_type, date, time, name, place, note, photo_description, mood, energy, hunger, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
            )
            .bind(mealId, uid, a.meal_type, a.date ?? today(), a.time ?? now(), a.name ?? null, a.place ?? null, a.note ?? null, a.photo_description ?? null, a.mood ?? null, a.energy ?? null, a.hunger ?? null, Date.now()),
          ...stmts,
        ]);
      } catch (err) {
        return fail((err as Error).message);
      }
      const meal = (await loadMeal(mealId))!;
      return ok(
        meal,
        `Logged ${meal.meal_type}${meal.name ? ` (${meal.name})` : ""}: ${fmt(meal.totals.calories)} kcal · ${fmt(meal.totals.protein_g)} g protein${meal.has_estimates ? " (estimated)" : ""}. ${await dayLine(meal.date)}`,
      );
    },
  );

  server.registerTool(
    "add_food_items",
    {
      title: "Add food items to meal",
      description: "Add items to an existing meal (id from list_meals / log_meal). Estimate missing nutrition yourself and set estimated: true.",
      inputSchema: z.object({ meal_id: z.string(), items: z.array(itemInput).min(1).max(50) }),
    },
    async (a) => {
      if (!(await getMealRow(a.meal_id))) return fail(`Meal ${a.meal_id} not found`);
      try {
        await db.batch(await insertItems(a.meal_id, a.items));
      } catch (err) {
        return fail((err as Error).message);
      }
      const meal = (await loadMeal(a.meal_id))!;
      return ok(meal, `Added ${a.items.length} item(s); ${meal.meal_type} now ${fmt(meal.totals.calories)} kcal.`);
    },
  );

  server.registerTool(
    "list_meals",
    {
      title: "List meals",
      description: "Meals newest first with totals and items, filtered by period, meal type or text (meal name, place, note or food name).",
      inputSchema: z.object({
        ...zPeriodInput,
        period: z.enum(PERIODS).default("last_7_days").describe("Named period in the user's time zone; use 'custom' with from/to"),
        meal_type: mealType.optional(),
        search: z.string().trim().min(1).max(120).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      const { results } = await db
        .prepare(
          `SELECT ${MEAL_COLS} FROM meals m WHERE m.user_id = ?1 AND m.date BETWEEN ?2 AND ?3 AND (?4 IS NULL OR m.meal_type = ?4)
             AND (?5 IS NULL OR m.name LIKE '%' || ?5 || '%' OR m.place LIKE '%' || ?5 || '%' OR m.note LIKE '%' || ?5 || '%'
                  OR EXISTS (SELECT 1 FROM meal_items i WHERE i.meal_id = m.id AND i.name LIKE '%' || ?5 || '%'))
           ORDER BY m.date DESC, m.time DESC LIMIT ?6`,
        )
        .bind(uid, r.from, r.to, a.meal_type ?? null, a.search ?? null, a.limit)
        .all<MealRow>();
      const items = await itemsFor(results.map((m) => m.id));
      const meals = results.map((m) => fmtMeal(m, items.get(m.id) ?? []));
      return ok({ period: r, count: meals.length, totals: sumTotals(meals.map((m) => m.totals)), meals });
    },
  );

  server.registerTool(
    "get_meal",
    { title: "Get meal", description: "One meal with all its items and totals.", inputSchema: z.object({ id: z.string() }), annotations: { readOnlyHint: true } },
    async ({ id: mealId }) => {
      const meal = await loadMeal(mealId);
      return meal ? ok(meal) : fail(`Meal ${mealId} not found`);
    },
  );

  server.registerTool(
    "update_meal",
    {
      title: "Update meal",
      description: "Change a meal's type, date, time, name, place, note, photo description or mood/energy/hunger ratings.",
      inputSchema: z.object({
        id: z.string(),
        meal_type: mealType.optional(),
        date: zDate.optional(),
        time: zTime.optional(),
        name: text(120).optional(),
        place: text(120).optional(),
        note: text(1000).optional(),
        photo_description: text(1000).optional(),
        mood: rating.optional(),
        energy: rating.optional(),
        hunger: rating.optional(),
      }),
    },
    async (a) => {
      const res = await db
        .prepare(
          `UPDATE meals SET meal_type = COALESCE(?1, meal_type), date = COALESCE(?2, date), time = COALESCE(?3, time), name = COALESCE(?4, name),
             place = COALESCE(?5, place), note = COALESCE(?6, note), photo_description = COALESCE(?7, photo_description),
             mood = COALESCE(?8, mood), energy = COALESCE(?9, energy), hunger = COALESCE(?10, hunger)
           WHERE id = ?11 AND user_id = ?12`,
        )
        .bind(a.meal_type ?? null, a.date ?? null, a.time ?? null, a.name ?? null, a.place ?? null, a.note ?? null, a.photo_description ?? null, a.mood ?? null, a.energy ?? null, a.hunger ?? null, a.id, uid)
        .run();
      return res.meta.changes ? ok(await loadMeal(a.id), "Meal updated.") : fail(`Meal ${a.id} not found`);
    },
  );

  server.registerTool(
    "update_meal_item",
    {
      title: "Update meal item",
      description:
        "Correct one food item (id from get_meal / list_meals): name, portion or nutrition. For an item logged from a saved food, `servings` rescales its nutrition.",
      inputSchema: z.object({
        id: z.string(),
        name: z.string().trim().min(1).max(120).optional(),
        quantity: z.number().positive().max(100000).optional(),
        unit: z.enum(PORTION_UNITS).optional(),
        servings: z.number().positive().max(100).optional(),
        ...nutrientFields,
        estimated: z.boolean().optional(),
      }),
    },
    async (a) => {
      const item = await db.prepare("SELECT * FROM meal_items WHERE id = ?1 AND user_id = ?2").bind(a.id, uid).first<ItemRow>();
      if (!item) return fail(`Meal item ${a.id} not found`);
      const next: Record<string, number | string | null> = {};
      if (a.servings !== undefined && item.food_id) {
        const food = await db.prepare("SELECT * FROM foods WHERE id = ?1 AND user_id = ?2").bind(item.food_id, uid).first<FoodRow>();
        if (food) {
          for (const k of NUTRIENTS) next[k] = food[k] === null ? null : food[k]! * a.servings;
          next.quantity = round(food.serving_qty * a.servings, 1);
          next.unit = food.serving_unit;
        }
        next.servings = a.servings;
      } else if (a.servings !== undefined && item.servings) {
        // No saved food anymore: scale proportionally.
        const f = a.servings / item.servings;
        for (const k of NUTRIENTS) next[k] = item[k] === null ? null : item[k]! * f;
        if (item.quantity !== null) next.quantity = round(item.quantity * f, 1);
        next.servings = a.servings;
      }
      if (a.quantity !== undefined || a.unit !== undefined) {
        const p = normalizePortion(a.quantity ?? item.quantity, a.unit ?? item.unit);
        next.quantity = p.quantity;
        next.unit = p.unit;
      }
      for (const k of NUTRIENTS) if (a[k] !== undefined) next[k] = a[k]!;
      if (a.name !== undefined) next.name = a.name;
      if (a.estimated !== undefined) next.estimated = a.estimated ? 1 : 0;
      const cols = Object.keys(next);
      if (cols.length) {
        await db
          .prepare(`UPDATE meal_items SET ${cols.map((c, i) => `${c} = ?${i + 1}`).join(", ")} WHERE id = ?${cols.length + 1} AND user_id = ?${cols.length + 2}`)
          .bind(...cols.map((c) => next[c]), a.id, uid)
          .run();
      }
      return ok(await loadMeal(item.meal_id), "Item updated.");
    },
  );

  server.registerTool(
    "delete_meal",
    { title: "Delete meal", description: "Delete a meal and all its items.", inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true } },
    async ({ id: mealId }) => {
      if (!(await getMealRow(mealId))) return fail(`Meal ${mealId} not found`);
      await db.batch([
        db.prepare("DELETE FROM meal_items WHERE meal_id = ?1 AND user_id = ?2").bind(mealId, uid),
        db.prepare("DELETE FROM meals WHERE id = ?1 AND user_id = ?2").bind(mealId, uid),
      ]);
      return ok({ deleted: mealId }, "Meal deleted.");
    },
  );

  server.registerTool(
    "delete_meal_item",
    { title: "Delete meal item", description: "Remove one food item from a meal.", inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true } },
    async ({ id: itemId }) => {
      const item = await db.prepare("SELECT meal_id FROM meal_items WHERE id = ?1 AND user_id = ?2").bind(itemId, uid).first<{ meal_id: string }>();
      if (!item) return fail(`Meal item ${itemId} not found`);
      await db.prepare("DELETE FROM meal_items WHERE id = ?1 AND user_id = ?2").bind(itemId, uid).run();
      return ok({ deleted: itemId, meal: await loadMeal(item.meal_id) }, "Item removed.");
    },
  );

  server.registerTool(
    "copy_meal",
    {
      title: "Copy meal",
      description:
        "Re-log a previous meal with all its items, e.g. 'same breakfast as yesterday'. Give meal_id, or from_date (default yesterday) + meal_type to pick the latest such meal that day.",
      inputSchema: z.object({
        meal_id: z.string().optional(),
        from_date: zDate.optional().describe("Defaults to yesterday"),
        meal_type: mealType.optional().describe("Which meal of from_date to copy"),
        to_date: zDate.optional().describe("Defaults to today"),
        to_meal_type: mealType.optional().describe("Defaults to the original type"),
        time: zTime.optional().describe("Defaults to now"),
      }),
    },
    async (a) => {
      let src: MealRow | null;
      if (a.meal_id) src = await getMealRow(a.meal_id);
      else {
        if (!a.meal_type) return fail("Give meal_id, or meal_type (with an optional from_date) to pick the meal to copy.");
        src = await db
          .prepare(`SELECT ${MEAL_COLS} FROM meals WHERE user_id = ?1 AND date = ?2 AND meal_type = ?3 ORDER BY time DESC LIMIT 1`)
          .bind(uid, a.from_date ?? addDays(today(), -1), a.meal_type)
          .first<MealRow>();
      }
      if (!src) return fail(a.meal_id ? `Meal ${a.meal_id} not found` : `No ${a.meal_type} logged on ${a.from_date ?? addDays(today(), -1)}`);
      const newId = id();
      const t = Date.now();
      await db.batch([
        db
          .prepare(
            `INSERT INTO meals (id, user_id, meal_type, date, time, name, place, note, photo_description, mood, energy, hunger, created_at)
             SELECT ?1, user_id, ?2, ?3, ?4, name, place, NULL, NULL, NULL, NULL, NULL, ?5 FROM meals WHERE id = ?6 AND user_id = ?7`,
          )
          .bind(newId, a.to_meal_type ?? src.meal_type, a.to_date ?? today(), a.time ?? now(), t, src.id, uid),
        db
          .prepare(
            `INSERT INTO meal_items (id, meal_id, user_id, food_id, name, quantity, unit, servings, ${NUTRIENTS.join(", ")}, estimated, position, created_at)
             SELECT lower(hex(randomblob(16))), ?1, user_id, food_id, name, quantity, unit, servings, ${NUTRIENTS.join(", ")}, estimated, position, ?2
             FROM meal_items WHERE meal_id = ?3 AND user_id = ?4`,
          )
          .bind(newId, t, src.id, uid),
      ]);
      const meal = (await loadMeal(newId))!;
      return ok(meal, `Copied ${src.meal_type} from ${src.date} to ${meal.date}: ${fmt(meal.totals.calories)} kcal. ${await dayLine(meal.date)}`);
    },
  );

  // ---------- food library ----------

  server.registerTool(
    "save_food",
    {
      title: "Save food",
      description:
        "Save a custom food / favorite with nutrition PER SERVING (e.g. 'my protein shake': 1 scoop = 120 kcal, 24 g protein). Saving an existing name updates it. " +
        "Then log it with log_meal items { food, servings }.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(120),
        brand: text(80).optional(),
        serving_qty: z.number().positive().max(100000).default(1).describe("Size of one serving, in serving_unit"),
        serving_unit: z.enum(PORTION_UNITS).default("serving"),
        ...nutrientFields,
        favorite: z.boolean().default(false),
      }),
    },
    async (a) => {
      const p = normalizePortion(a.serving_qty, a.serving_unit);
      await db
        .prepare(
          `INSERT INTO foods (id, user_id, name, brand, serving_qty, serving_unit, ${NUTRIENTS.join(", ")}, favorite, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
           ON CONFLICT (user_id, name) DO UPDATE SET brand = excluded.brand, serving_qty = excluded.serving_qty, serving_unit = excluded.serving_unit,
             ${NUTRIENTS.map((k) => `${k} = excluded.${k}`).join(", ")}, favorite = excluded.favorite`,
        )
        .bind(id(), uid, a.name, a.brand ?? null, p.quantity, p.unit, ...NUTRIENTS.map((k) => a[k] ?? null), a.favorite ? 1 : 0, Date.now())
        .run();
      const f = (await findFood(a.name))!;
      return ok(fmtFood(f, units()), `Saved ${f.name}: ${fmt(f.calories ?? 0)} kcal per ${portionText(f.serving_qty, f.serving_unit, units())}.`);
    },
  );

  server.registerTool(
    "search_foods",
    {
      title: "Search foods",
      description:
        "Search the user's saved foods and previously logged items (ranked by how often they're eaten). Use it to reuse exact nutrition and typical portions. Empty query lists the most frequent.",
      inputSchema: z.object({ query: z.string().trim().max(120).default(""), limit: z.number().int().min(1).max(100).default(20) }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const [saved, logged] = await Promise.all([
        db
          .prepare(
            `SELECT f.*, (SELECT COUNT(*) FROM meal_items i WHERE i.food_id = f.id) AS uses FROM foods f
             WHERE f.user_id = ?1 AND (f.name LIKE '%' || ?2 || '%' OR f.brand LIKE '%' || ?2 || '%')
             ORDER BY f.favorite DESC, uses DESC, f.name LIMIT ?3`,
          )
          .bind(uid, a.query, a.limit)
          .all<FoodRow & { uses: number }>(),
        topFoods(db, uid, "0000-01-01", "9999-12-31", a.limit, a.query),
      ]);
      return ok({
        saved_foods: saved.results.map((f) => ({ ...fmtFood(f, units()), times_logged: f.uses })),
        logged_items: logged.map((f) => ({
          name: f.name,
          times_logged: f.times,
          last_logged: f.last_date,
          avg_calories: Math.round(f.avg_calories),
          avg_protein_g: round(f.avg_protein, 1),
          typical_portion: portionText(f.quantity, f.unit, units()),
        })),
      });
    },
  );

  server.registerTool(
    "delete_food",
    { title: "Delete saved food", description: "Remove a saved food from the library (logged meals keep their nutrition).", inputSchema: z.object({ name: z.string().trim().min(1) }), annotations: { destructiveHint: true } },
    async (a) => {
      const f = await findFood(a.name);
      if (!f) return fail(`No saved food named "${a.name}"`);
      await db.batch([
        db.prepare("UPDATE meal_items SET food_id = NULL WHERE food_id = ?1 AND user_id = ?2").bind(f.id, uid),
        db.prepare("DELETE FROM foods WHERE id = ?1 AND user_id = ?2").bind(f.id, uid),
      ]);
      return ok({ deleted: f.name });
    },
  );

  // ---------- water ----------

  server.registerTool(
    "log_water",
    {
      title: "Log water",
      description: `Log water drunk. Unit defaults to the user's units (${user.units === "imperial" ? "fl_oz" : "ml"}); a cup is 240 ml, a glass 250 ml, a bottle 500 ml.`,
      inputSchema: z.object({
        amount: z.number().positive().max(10000),
        unit: z.enum(WATER_UNITS).optional(),
        date: zDate.optional(),
        time: zTime.optional(),
      }),
    },
    async (a) => {
      const ml = waterToMl(a.amount, a.unit ?? (units() === "imperial" ? "fl_oz" : "ml"));
      if (ml > 10000) return fail("That's more than 10 litres at once, please check the amount.");
      const wid = id();
      const date = a.date ?? today();
      await db
        .prepare("INSERT INTO water_logs (id, user_id, date, time, amount_ml, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(wid, uid, date, a.time ?? now(), ml, Date.now())
        .run();
      const total = await db.prepare("SELECT SUM(amount_ml) AS ml FROM water_logs WHERE user_id = ?1 AND date = ?2").bind(uid, date).first<number>("ml");
      const goal = (await getGoals(db, uid))?.water_ml ?? null;
      return ok(
        { id: wid, date, amount: waterOut(ml, units()), day_total: waterOut(total, units()), goal: goal === null ? null : waterOut(goal, units()), unit: waterUnit(units()) },
        `Logged ${waterText(ml, units())} of water. ${date === today() ? "Today" : date}: ${waterText(total, units())}${goal ? ` of ${waterText(goal, units())}` : ""}.`,
      );
    },
  );

  server.registerTool(
    "delete_water",
    { title: "Delete water entry", description: "Remove a water entry (ids are listed by daily_summary).", inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true } },
    async ({ id: wid }) => {
      const res = await db.prepare("DELETE FROM water_logs WHERE id = ?1 AND user_id = ?2").bind(wid, uid).run();
      return res.meta.changes ? ok({ deleted: wid }) : fail(`Water entry ${wid} not found`);
    },
  );

  // ---------- goals ----------

  server.registerTool(
    "set_nutrition_goals",
    {
      title: "Set nutrition goals",
      description:
        "Daily targets: calories, protein, carbs, fat, fiber (targets), sugar and sodium (maximums), water (in the user's units). Only the fields given change; pass 0 to clear one.",
      inputSchema: z.object({
        calories: z.number().min(0).max(20000).optional(),
        protein_g: z.number().min(0).max(1000).optional(),
        carbs_g: z.number().min(0).max(2000).optional(),
        fat_g: z.number().min(0).max(1000).optional(),
        fiber_g: z.number().min(0).max(300).optional(),
        sugar_max_g: z.number().min(0).max(1000).optional(),
        sodium_max_mg: z.number().min(0).max(50000).optional(),
        water: z.number().min(0).max(20000).optional().describe(`Daily water goal in ${user.units === "imperial" ? "fl oz" : "ml"}`),
      }),
    },
    async (a) => {
      const water = a.water === undefined ? undefined : units() === "imperial" ? a.water * ML_PER_FL_OZ : a.water;
      const vals = [a.calories, a.protein_g, a.carbs_g, a.fat_g, a.fiber_g, a.sugar_max_g, a.sodium_max_mg, water];
      // undefined → keep, 0 → clear (NULL), otherwise set.
      const cols = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugar_max_g", "sodium_max_mg", "water_ml"];
      await db
        .prepare(
          `INSERT INTO nutrition_goals (user_id, ${cols.join(", ")}, updated_at) VALUES (?1, ${cols.map((_, i) => `NULLIF(?${i + 2}, 0)`).join(", ")}, ?10)
           ON CONFLICT (user_id) DO UPDATE SET ${cols.map((c, i) => `${c} = CASE WHEN ?${i + 2} IS NULL THEN ${c} ELSE NULLIF(?${i + 2}, 0) END`).join(", ")}, updated_at = ?10`,
        )
        .bind(uid, ...vals.map((v) => v ?? null), Date.now())
        .run();
      return ok(fmtGoals(await getGoals(db, uid), units()), "Nutrition goals saved.");
    },
  );

  server.registerTool(
    "get_nutrition_goals",
    { title: "Get nutrition goals", description: "The user's daily nutrition targets.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => {
      const g = await getGoals(db, uid);
      return g ? ok(fmtGoals(g, units())) : ok({ goals: null }, "No nutrition goals set yet, ask the user (or suggest sensible ones) and call set_nutrition_goals.");
    },
  );

  // ---------- daily view ----------

  server.registerTool(
    "daily_summary",
    {
      title: "Daily summary",
      description: "One day: totals vs goals, remaining, macro split %, per-meal breakdown and water.",
      inputSchema: z.object({ date: zDate.optional().describe("Defaults to today") }),
      annotations: { readOnlyHint: true },
    },
    async (a) => ok(await daySummary(a.date ?? today())),
  );

  async function daySummary(date: string) {
    const [{ results: mealRows }, { results: water }, goals] = await Promise.all([
      db.prepare(`SELECT ${MEAL_COLS} FROM meals WHERE user_id = ?1 AND date = ?2 ORDER BY time`).bind(uid, date).all<MealRow>(),
      db.prepare("SELECT id, time, amount_ml FROM water_logs WHERE user_id = ?1 AND date = ?2 ORDER BY time").bind(uid, date).all<{ id: string; time: string; amount_ml: number }>(),
      getGoals(db, uid),
    ]);
    const items = await itemsFor(mealRows.map((m) => m.id));
    const meals = mealRows.map((m) => fmtMeal(m, items.get(m.id) ?? []));
    const totals = sumTotals(meals.map((m) => m.totals));
    const waterMl = water.reduce((s, w) => s + w.amount_ml, 0);
    return {
      date,
      totals,
      goals: fmtGoals(goals, units()),
      remaining: remaining(totals, waterMl, goals, units()),
      percent_of_goal: goals ? percentOfGoals(totals, waterMl, goals) : null,
      macro_split: macroSplit(totals),
      water: { total: waterOut(waterMl, units()), goal: goals?.water_ml ? waterOut(goals.water_ml, units()) : null, unit: waterUnit(units()), entries: water.map((w) => ({ id: w.id, time: w.time, amount: waterOut(w.amount_ml, units()) })) },
      meals: meals.map((m) => ({ ...m, items: m.items.map((i) => ({ id: i.id, name: i.name, portion: i.portion, calories: i.calories, protein_g: i.protein_g, estimated: i.estimated })) })),
      meal_types_logged: [...new Set(meals.map((m) => m.meal_type))],
    };
  }

  // ---------- weight ----------

  server.registerTool(
    "log_weight",
    {
      title: "Log weight",
      description: `Log body weight in ${user.units === "imperial" ? "lb" : "kg"} (one entry per day; logging again replaces it). Returns the trend.`,
      inputSchema: z.object({ weight: z.number().positive().max(1500), date: zDate.optional(), note: text(300).optional() }),
    },
    async (a) => {
      const kg = units() === "imperial" ? a.weight * KG_PER_LB : a.weight;
      if (kg < 20 || kg > 400) return fail(`That weight looks wrong (${a.weight} ${weightUnit(units())}).`);
      const date = a.date ?? today();
      await db
        .prepare(
          `INSERT INTO weights (id, user_id, date, weight_kg, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT (user_id, date) DO UPDATE SET weight_kg = excluded.weight_kg, note = COALESCE(excluded.note, note)`,
        )
        .bind(id(), uid, date, kg, a.note ?? null, Date.now())
        .run();
      const trend = await weightTrend(db, uid, today(), units());
      return ok({ date, weight: weightOut(kg, units()), unit: weightUnit(units()), trend }, `Logged ${weightOut(kg, units())} ${weightUnit(units())} on ${date}.`);
    },
  );

  server.registerTool(
    "weight_history",
    {
      title: "Weight history",
      description: "Weight entries over a period with the 30-day trend.",
      inputSchema: z.object({ ...zPeriodInput, period: z.enum(PERIODS).default("last_90_days").describe("Named period in the user's time zone; use 'custom' with from/to") }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      const { results } = await db
        .prepare("SELECT date, weight_kg, note FROM weights WHERE user_id = ?1 AND date BETWEEN ?2 AND ?3 ORDER BY date")
        .bind(uid, r.from, r.to)
        .all<{ date: string; weight_kg: number; note: string | null }>();
      return ok({
        period: r,
        unit: weightUnit(units()),
        entries: results.map((w) => ({ date: w.date, weight: weightOut(w.weight_kg, units()), note: w.note })),
        trend: await weightTrend(db, uid, today(), units()),
      });
    },
  );

  // ---------- follow-up & report ----------

  server.registerTool(
    "follow_up",
    {
      title: "Food follow-up",
      description:
        "Check-in: today so far vs goals (remaining calories/macros, water), meals not logged yet given the time, logging streak, last-7-days goal-hit rate, patterns (late-night snacking, low fiber, high sodium) , weight trend and nudges.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const t = today();
      const time = now();
      const day = await daySummary(t);
      const goals = await getGoals(db, uid);
      const missing = missingMeals(day.meal_types_logged, time);
      const streak = await loggingStreak(db, uid, t);
      const week = goalHitRate(await dailyTotals(db, uid, addDays(t, -7), addDays(t, -1)), goals);
      const pats = await patterns(db, uid, addDays(t, -13), t, goals);
      const weight = await weightTrend(db, uid, t, units());
      const nudges: string[] = [];

      if (!day.meals.length) nudges.push("No meals logged today yet, tell me what you've eaten so far.");
      for (const mt of missing) if (day.meals.length) nudges.push(`No ${mt} logged yet today, did you have one?`);
      if (!goals) nudges.push("No nutrition goals set yet, set daily calories and protein with set_nutrition_goals to track progress.");
      if (goals?.calories && day.meals.length) {
        const left = goals.calories - day.totals.calories;
        nudges.push(left >= 0 ? `${fmt(Math.round(left))} kcal left for today.` : `${fmt(Math.round(-left))} kcal over today's goal.`);
      }
      if (goals?.protein_g && day.meals.length && day.totals.protein_g < goals.protein_g)
        nudges.push(`${fmt(round(goals.protein_g - day.totals.protein_g, 0))} g protein to go, a protein-rich next meal would help.`);
      if (goals?.water_ml) {
        const waterMl = (await dailyWater(db, uid, t, t))[0]?.ml ?? 0;
        if (waterMl < goals.water_ml * 0.5 && time >= "14:00") nudges.push(`Only ${waterText(waterMl, units())} of water so far (goal ${waterText(goals.water_ml, units())}), time for a glass.`);
      } else if (!day.water.entries.length && time >= "12:00") nudges.push("No water logged today.");
      if (streak.current >= 3) nudges.push(`${streak.current}-day logging streak, keep it going!`);
      else if (!streak.current && streak.last_logged) nudges.push(`Nothing logged since ${streak.last_logged}.`);
      if (week.days_logged && week.calorie_hit_rate !== null && week.calorie_hit_rate < 50) nudges.push(`Calories were on target on only ${week.calorie_hits} of ${week.days_logged} logged days last week.`);
      nudges.push(...pats.notes);
      if (weight.latest && weight.days_since_last !== null && weight.days_since_last >= 7) nudges.push(`Last weigh-in was ${weight.days_since_last} days ago.`);

      return ok({
        today: t,
        local_time: time,
        totals: day.totals,
        goals: day.goals,
        remaining: day.remaining,
        macro_split: day.macro_split,
        water: { total: day.water.total, goal: day.water.goal, unit: day.water.unit },
        meals_logged: day.meals.map((m) => ({ id: m.id, meal_type: m.meal_type, time: m.time, calories: m.totals.calories })),
        missing_meals: missing,
        streak_days: streak.current,
        longest_streak_days: streak.longest,
        last_7_days: week,
        patterns: pats,
        weight_trend: weight,
        nudges,
      });
    },
  );

  server.registerTool(
    "generate_report",
    {
      title: "Generate nutrition report",
      description:
        "Well-organized nutrition report for a period: KPIs, highlights vs previous period, daily averages vs goals, macro split, calories by day, meals by type, top foods, highest-calorie meals, hydration, weight trend and mood/energy patterns. Returns Markdown plus a printable link.",
      inputSchema: z.object(zPeriodInput),
      annotations: { readOnlyHint: true },
    },
    async (a) => reportResult(ctx, await buildReport(ctx, resolvePeriod(user.timezone, a.period, a.from, a.to))),
  );

  return server;
}

// ---------- formatting shared with the report ----------

export function fmtFood(f: FoodRow, units: Units) {
  return {
    id: f.id,
    name: f.name,
    brand: f.brand,
    serving: portionText(f.serving_qty, f.serving_unit, units),
    serving_qty: f.serving_qty,
    serving_unit: f.serving_unit,
    per_serving: Object.fromEntries(NUTRIENTS.map((k) => [k, f[k]])),
    favorite: !!f.favorite,
  };
}

export function fmtGoals(g: GoalsRow | null, units: Units) {
  if (!g) return null;
  return {
    calories: g.calories,
    protein_g: g.protein_g,
    carbs_g: g.carbs_g,
    fat_g: g.fat_g,
    fiber_g: g.fiber_g,
    sugar_max_g: g.sugar_max_g,
    sodium_max_mg: g.sodium_max_mg,
    water: g.water_ml === null ? null : waterOut(g.water_ml, units),
    water_unit: waterUnit(units),
  };
}

function remaining(t: Totals, waterMl: number, g: GoalsRow | null, units: Units) {
  if (!g) return null;
  const left = (goal: number | null, v: number, digits = 1) => (goal === null ? null : round(goal - v, digits));
  return {
    calories: left(g.calories, t.calories, 0),
    protein_g: left(g.protein_g, t.protein_g),
    carbs_g: left(g.carbs_g, t.carbs_g),
    fat_g: left(g.fat_g, t.fat_g),
    fiber_g: left(g.fiber_g, t.fiber_g),
    sugar_g_allowance: left(g.sugar_max_g, t.sugar_g),
    sodium_mg_allowance: left(g.sodium_max_mg, t.sodium_mg, 0),
    water: g.water_ml === null ? null : waterOut(Math.max(0, g.water_ml - waterMl), units),
  };
}

function percentOfGoals(t: Totals, waterMl: number, g: GoalsRow) {
  const p = (v: number, goal: number | null) => (goal ? Math.round((v / goal) * 100) : null);
  return {
    calories: p(t.calories, g.calories),
    protein_g: p(t.protein_g, g.protein_g),
    carbs_g: p(t.carbs_g, g.carbs_g),
    fat_g: p(t.fat_g, g.fat_g),
    fiber_g: p(t.fiber_g, g.fiber_g),
    sugar_g: p(t.sugar_g, g.sugar_max_g),
    sodium_mg: p(t.sodium_mg, g.sodium_max_mg),
    water: p(waterMl, g.water_ml),
  };
}

// ---------- queries shared with the report ----------

export const getGoals = (db: D1Database, uid: string) => db.prepare("SELECT * FROM nutrition_goals WHERE user_id = ?1").bind(uid).first<GoalsRow>();

export interface DayTotals extends Totals {
  date: string;
  meals: number;
}

/** Per-day nutrition totals for days with at least one meal. */
export async function dailyTotals(db: D1Database, uid: string, from: string, to: string): Promise<DayTotals[]> {
  const { results } = await db
    .prepare(
      `SELECT m.date, COUNT(DISTINCT m.id) AS meals, ${SUM_SQL}
       FROM meals m LEFT JOIN meal_items i ON i.meal_id = m.id
       WHERE m.user_id = ?1 AND m.date BETWEEN ?2 AND ?3 GROUP BY m.date ORDER BY m.date`,
    )
    .bind(uid, from, to)
    .all<DayTotals>();
  return results;
}

export async function dailyWater(db: D1Database, uid: string, from: string, to: string) {
  const { results } = await db
    .prepare("SELECT date, SUM(amount_ml) AS ml FROM water_logs WHERE user_id = ?1 AND date BETWEEN ?2 AND ?3 GROUP BY date ORDER BY date")
    .bind(uid, from, to)
    .all<{ date: string; ml: number }>();
  return results;
}

/** Calories within ±10% of the goal; protein at or above the goal. */
export const calorieHit = (d: Totals, g: GoalsRow | null) => (g?.calories ? Math.abs(d.calories - g.calories) <= g.calories * 0.1 : null);
export const proteinHit = (d: Totals, g: GoalsRow | null) => (g?.protein_g ? d.protein_g >= g.protein_g : null);

export function goalHitRate(days: DayTotals[], g: GoalsRow | null) {
  const pct = (n: number) => (days.length ? Math.round((n / days.length) * 100) : null);
  const calorieHits = days.filter((d) => calorieHit(d, g)).length;
  const proteinHits = days.filter((d) => proteinHit(d, g)).length;
  return {
    days_logged: days.length,
    calorie_hits: g?.calories ? calorieHits : null,
    protein_hits: g?.protein_g ? proteinHits : null,
    calorie_hit_rate: g?.calories ? pct(calorieHits) : null,
    protein_hit_rate: g?.protein_g ? pct(proteinHits) : null,
  };
}

export async function loggingStreak(db: D1Database, uid: string, today: string) {
  const { results } = await db
    .prepare("SELECT DISTINCT date FROM meals WHERE user_id = ?1 AND date <= ?2 ORDER BY date DESC LIMIT 1000")
    .bind(uid, today)
    .all<{ date: string }>();
  const dates = results.map((r) => r.date);
  // A streak is still alive when today has nothing yet but yesterday does.
  let current = 0;
  let cursor = dates[0] === today ? today : addDays(today, -1);
  for (const d of dates) {
    if (d !== cursor) {
      if (d > cursor) continue;
      break;
    }
    current++;
    cursor = addDays(cursor, -1);
  }
  let longest = 0;
  let run = 0;
  for (let i = 0; i < dates.length; i++) {
    run = i && daysBetween(dates[i], dates[i - 1]) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return { current, longest, last_logged: dates[0] ?? null };
}

export const LATE_NIGHT = "21:30";
export const DEFAULT_SODIUM_MAX = 2300;
export const DEFAULT_FIBER_MIN = 25;

/** Eating patterns over a window: late-night snacking, low-fiber days, high-sodium days, high-sugar days. */
export async function patterns(db: D1Database, uid: string, from: string, to: string, g: GoalsRow | null) {
  const [days, late] = await Promise.all([
    dailyTotals(db, uid, from, to),
    db
      .prepare(
        `SELECT COUNT(DISTINCT date) AS days, COUNT(*) AS meals FROM meals
         WHERE user_id = ?1 AND date BETWEEN ?2 AND ?3 AND (time >= ?4 OR time < '04:00') AND meal_type IN ('snack', 'drink', 'dinner')`,
      )
      .bind(uid, from, to, LATE_NIGHT)
      .first<{ days: number; meals: number }>(),
  ]);
  const fiberMin = g?.fiber_g ? g.fiber_g * 0.7 : DEFAULT_FIBER_MIN * 0.7;
  const sodiumMax = g?.sodium_max_mg ?? DEFAULT_SODIUM_MAX;
  const lowFiber = days.filter((d) => d.calories >= 800 && d.fiber_g < fiberMin);
  const highSodium = days.filter((d) => d.sodium_mg > sodiumMax);
  const highSugar = g?.sugar_max_g ? days.filter((d) => d.sugar_g > g.sugar_max_g!) : [];
  const notes: string[] = [];
  const lateDays = late?.days ?? 0;
  if (lateDays >= 3) notes.push(`Late-night eating (after ${LATE_NIGHT}) on ${lateDays} of the last ${daysBetween(from, to) + 1} days.`);
  if (days.length >= 3 && lowFiber.length >= Math.ceil(days.length / 2)) notes.push(`Fiber was low on ${lowFiber.length} of ${days.length} logged days, add veg, fruit, legumes or whole grains.`);
  if (highSodium.length >= 2) notes.push(`Sodium went above ${fmt(sodiumMax)} mg on ${highSodium.length} days.`);
  if (highSugar.length >= 2) notes.push(`Sugar went above your ${fmt(g!.sugar_max_g!)} g limit on ${highSugar.length} days.`);
  return {
    window: { from, to },
    days_logged: days.length,
    late_night_days: lateDays,
    low_fiber_days: lowFiber.map((d) => d.date),
    high_sodium_days: highSodium.map((d) => d.date),
    high_sugar_days: highSugar.map((d) => d.date),
    notes,
  };
}

export async function weightTrend(db: D1Database, uid: string, today: string, units: Units) {
  const { results } = await db
    .prepare("SELECT date, weight_kg FROM weights WHERE user_id = ?1 AND date <= ?2 ORDER BY date DESC LIMIT 120")
    .bind(uid, today)
    .all<{ date: string; weight_kg: number }>();
  if (!results.length) return { latest: null, unit: weightUnit(units), latest_date: null, days_since_last: null, change_30d: null, per_week: null, direction: null };
  const latest = results[0];
  const window = results.filter((r) => daysBetween(r.date, latest.date) <= 30);
  const first = window[window.length - 1];
  const span = daysBetween(first.date, latest.date);
  const change = latest.weight_kg - first.weight_kg;
  const perWeek = span ? (change / span) * 7 : null;
  return {
    latest: weightOut(latest.weight_kg, units),
    unit: weightUnit(units),
    latest_date: latest.date,
    days_since_last: daysBetween(latest.date, today),
    change_30d: span ? round(units === "imperial" ? change / KG_PER_LB : change, 1) : null,
    per_week: perWeek === null ? null : round(units === "imperial" ? perWeek / KG_PER_LB : perWeek, 2),
    direction: perWeek === null ? null : Math.abs(perWeek) < 0.1 ? "stable" : perWeek < 0 ? "down" : "up",
  };
}

/** Most frequently logged items (grouped case-insensitively by name). */
export async function topFoods(db: D1Database, uid: string, from: string, to: string, limit: number, query = "") {
  const { results } = await db
    .prepare(
      `SELECT MIN(i.name COLLATE BINARY) AS name, COUNT(*) AS times, MAX(m.date) AS last_date, COALESCE(SUM(i.calories), 0) AS total_calories,
              COALESCE(AVG(i.calories), 0) AS avg_calories, COALESCE(AVG(i.protein_g), 0) AS avg_protein,
              AVG(i.quantity) AS quantity, MIN(i.unit) AS unit
       FROM meal_items i JOIN meals m ON m.id = i.meal_id
       WHERE i.user_id = ?1 AND m.date BETWEEN ?2 AND ?3 AND i.name LIKE '%' || ?4 || '%'
       GROUP BY lower(i.name) ORDER BY times DESC, total_calories DESC LIMIT ?5`,
    )
    .bind(uid, from, to, query, limit)
    .all<{ name: string; times: number; last_date: string; total_calories: number; avg_calories: number; avg_protein: number; quantity: number | null; unit: string | null }>();
  return results;
}

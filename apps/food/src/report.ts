import { addDays, daysBetween, localDate, round, TOOLS, type Bar, type DateRange, type Report, type Section, type Tone, type ToolContext } from "@quemo/core";
import {
  calorieHit,
  dailyTotals,
  dailyWater,
  fmt,
  getGoals,
  goalHitRate,
  macroSplit,
  NUTRIENTS,
  patterns,
  proteinHit,
  sumTotals,
  topFoods,
  waterText,
  weightOut,
  weightUnit,
  type DayTotals,
  type Env,
  type GoalsRow,
  type MealType,
  type Nutrient,
  type Totals,
} from "./server";

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

function change(current: number, previous: number): string {
  if (!previous) return current ? "new" : "-";
  const d = ((current - previous) / previous) * 100;
  return `${d > 0 ? "▲" : d < 0 ? "▼" : "="} ${Math.abs(Math.round(d))}%`;
}

function average(days: DayTotals[]): Totals {
  const t = sumTotals(days);
  const n = days.length || 1;
  return Object.fromEntries(NUTRIENTS.map((k) => [k, k === "calories" || k === "sodium_mg" ? Math.round(t[k] / n) : round(t[k] / n, 1)])) as Totals;
}

/** good / warn / bad for a daily average against a goal. kind: target (±), min (at least) or max (at most). */
function tone(value: number, goal: number | null, kind: "target" | "min" | "max"): Tone | undefined {
  if (!goal) return undefined;
  const r = value / goal;
  if (kind === "target") return Math.abs(r - 1) <= 0.1 ? "good" : Math.abs(r - 1) <= 0.2 ? "warn" : "bad";
  if (kind === "min") return r >= 1 ? "good" : r >= 0.8 ? "warn" : "bad";
  return r <= 1 ? "good" : r <= 1.1 ? "warn" : "bad";
}

const LABELS: Record<Nutrient, string> = {
  calories: "Calories",
  protein_g: "Protein",
  carbs_g: "Carbs",
  fat_g: "Fat",
  fiber_g: "Fiber",
  sugar_g: "Sugar",
  sodium_mg: "Sodium",
};
const UNIT: Record<Nutrient, string> = { calories: "kcal", protein_g: "g", carbs_g: "g", fat_g: "g", fiber_g: "g", sugar_g: "g", sodium_mg: "mg" };
const GOAL_OF: Record<Nutrient, { col: keyof GoalsRow; kind: "target" | "min" | "max" }> = {
  calories: { col: "calories", kind: "target" },
  protein_g: { col: "protein_g", kind: "min" },
  carbs_g: { col: "carbs_g", kind: "target" },
  fat_g: { col: "fat_g", kind: "target" },
  fiber_g: { col: "fiber_g", kind: "min" },
  sugar_g: { col: "sugar_max_g", kind: "max" },
  sodium_mg: { col: "sodium_max_mg", kind: "max" },
};

/** Acceptable macronutrient distribution ranges (% of calories). */
const AMDR = { protein: [10, 35], carbs: [45, 65], fat: [20, 35] } as const;

export async function buildReport(ctx: ToolContext<Env>, range: DateRange): Promise<Report> {
  const { env, user } = ctx;
  const db = env.DB;
  const uid = user.id;
  const units = user.units;
  const today = localDate(user.timezone);
  const kcal = (n: number) => `${fmt(Math.round(n))} kcal`;

  // Previous period of the same length, for comparisons.
  const prev = { from: addDays(range.from, -range.days), to: addDays(range.from, -1) };
  const elapsedDays = range.from > today ? 0 : Math.min(range.days, daysBetween(range.from, today) + 1);

  const [days, prevDays, goals, water, prevWater, byType, foods, biggest, weights, ratings] = await Promise.all([
    dailyTotals(db, uid, range.from, range.to),
    dailyTotals(db, uid, prev.from, prev.to),
    getGoals(db, uid),
    dailyWater(db, uid, range.from, range.to),
    dailyWater(db, uid, prev.from, prev.to),
    db
      .prepare(
        `SELECT m.meal_type, COUNT(DISTINCT m.id) AS meals, COALESCE(SUM(i.calories), 0) AS calories, COALESCE(SUM(i.protein_g), 0) AS protein
         FROM meals m LEFT JOIN meal_items i ON i.meal_id = m.id
         WHERE m.user_id = ?1 AND m.date BETWEEN ?2 AND ?3 GROUP BY m.meal_type ORDER BY calories DESC`,
      )
      .bind(uid, range.from, range.to)
      .all<{ meal_type: MealType; meals: number; calories: number; protein: number }>(),
    topFoods(db, uid, range.from, range.to, 10),
    db
      .prepare(
        `SELECT m.date, m.time, m.meal_type, m.name, COALESCE(SUM(i.calories), 0) AS calories, COALESCE(SUM(i.protein_g), 0) AS protein,
                group_concat(i.name, ', ') AS items
         FROM meals m JOIN meal_items i ON i.meal_id = m.id
         WHERE m.user_id = ?1 AND m.date BETWEEN ?2 AND ?3 GROUP BY m.id ORDER BY calories DESC LIMIT 10`,
      )
      .bind(uid, range.from, range.to)
      .all<{ date: string; time: string; meal_type: MealType; name: string | null; calories: number; protein: number; items: string }>(),
    db
      .prepare("SELECT date, weight_kg FROM weights WHERE user_id = ?1 AND date BETWEEN ?2 AND ?3 ORDER BY date")
      .bind(uid, range.from, range.to)
      .all<{ date: string; weight_kg: number }>(),
    db
      .prepare(
        `SELECT m.mood, m.energy, m.hunger, COALESCE(SUM(i.calories), 0) AS calories, COALESCE(SUM(i.sugar_g), 0) AS sugar
         FROM meals m LEFT JOIN meal_items i ON i.meal_id = m.id
         WHERE m.user_id = ?1 AND m.date BETWEEN ?2 AND ?3 AND (m.mood IS NOT NULL OR m.energy IS NOT NULL OR m.hunger IS NOT NULL) GROUP BY m.id`,
      )
      .bind(uid, range.from, range.to)
      .all<{ mood: number | null; energy: number | null; hunger: number | null; calories: number; sugar: number }>(),
  ]);
  const pats = await patterns(db, uid, range.from, range.to, goals);

  const avg = average(days);
  const prevAvg = average(prevDays);
  const hits = goalHitRate(days, goals);
  const waterTotal = water.reduce((s, w) => s + w.ml, 0);
  const avgWater = water.length ? waterTotal / water.length : 0;
  const prevAvgWater = prevWater.length ? prevWater.reduce((s, w) => s + w.ml, 0) / prevWater.length : 0;
  const waterMap = new Map(water.map((w) => [w.date, w.ml]));
  const g = (k: Nutrient) => (goals ? (goals[GOAL_OF[k].col] as number | null) : null);

  // ---------- highlights ----------
  const highlights: string[] = [];
  if (!days.length) highlights.push("No meals logged in this period yet.");
  else {
    if (prevDays.length) {
      highlights.push(`Average calories ${change(avg.calories, prevAvg.calories)} vs. the previous ${range.days} days (${kcal(avg.calories)} vs ${kcal(prevAvg.calories)}/day).`);
      highlights.push(`Average protein ${change(avg.protein_g, prevAvg.protein_g)} (${fmt(avg.protein_g)} g vs ${fmt(prevAvg.protein_g)} g/day).`);
      if (days.length !== prevDays.length) highlights.push(`Logged ${days.length} days vs ${prevDays.length} in the previous period.`);
    }
    if (goals?.calories && days.length >= 2) {
      const sorted = [...days].sort((x, y) => Math.abs(x.calories - goals.calories!) - Math.abs(y.calories - goals.calories!));
      highlights.push(`Best day: ${sorted[0].date} (${kcal(sorted[0].calories)}, closest to your ${kcal(goals.calories)} goal).`);
      const worst = sorted[sorted.length - 1];
      highlights.push(`Toughest day: ${worst.date} (${kcal(worst.calories)}, ${worst.calories > goals.calories ? "over" : "under"} goal by ${kcal(Math.abs(worst.calories - goals.calories))}).`);
    } else if (days.length >= 2) {
      const sorted = [...days].sort((x, y) => y.calories - x.calories);
      highlights.push(`Highest-calorie day: ${sorted[0].date} (${kcal(sorted[0].calories)}); lightest: ${sorted[sorted.length - 1].date} (${kcal(sorted[sorted.length - 1].calories)}).`);
    }
    if (hits.calorie_hit_rate !== null) highlights.push(`Calories on target (±10%) on ${hits.calorie_hits} of ${days.length} logged days (${hits.calorie_hit_rate}%).`);
    if (hits.protein_hit_rate !== null) highlights.push(`Protein goal reached on ${hits.protein_hits} of ${days.length} logged days.`);
    highlights.push(...patterns_notes(pats, days.length, goals));
  }
  if (weights.results.length >= 2) {
    const d = weights.results[weights.results.length - 1].weight_kg - weights.results[0].weight_kg;
    highlights.push(`Weight ${d < 0 ? "down" : d > 0 ? "up" : "unchanged"} ${fmt(Math.abs(weightOut(d, units)))} ${weightUnit(units)} over the period.`);
  }

  const sections: Section[] = [];

  // ---------- daily averages vs goals ----------
  const avgBars: Bar[] = NUTRIENTS.filter((k) => avg[k] || g(k)).map((k) => {
    const goal = g(k);
    return {
      label: LABELS[k],
      value: avg[k],
      max: Math.max(goal ?? 0, avg[k], 1),
      display: goal ? `${fmt(avg[k])} / ${fmt(goal)} ${UNIT[k]}${GOAL_OF[k].kind === "max" ? " max" : ""} (${Math.round((avg[k] / goal) * 100)}%)` : `${fmt(avg[k])} ${UNIT[k]} · no goal`,
      tone: tone(avg[k], goal, GOAL_OF[k].kind),
    };
  });
  if (water.length || goals?.water_ml)
    avgBars.push({
      label: "Water",
      value: avgWater,
      max: Math.max(goals?.water_ml ?? 0, avgWater, 1),
      display: goals?.water_ml ? `${waterText(avgWater, units)} / ${waterText(goals.water_ml, units)}` : `${waterText(avgWater, units)} · no goal`,
      tone: tone(avgWater, goals?.water_ml ?? null, "min"),
    });
  sections.push({
    title: "Daily averages vs goals",
    text: days.length ? `Averages over ${days.length} logged day${days.length === 1 ? "" : "s"}.${goals ? "" : " No goals set yet, ask your assistant to set daily calorie and protein targets."}` : undefined,
    bars: days.length ? avgBars : [],
    empty: "No meals logged in this period.",
  });

  // ---------- macro split ----------
  const split = macroSplit(sumTotals(days));
  sections.push({
    title: "Macro split",
    text: split ? "Share of calories from each macronutrient (typical healthy ranges: protein 10-35%, carbs 45-65%, fat 20-35%)." : undefined,
    bars: split
      ? (
          [
            ["Protein", split.protein_pct, AMDR.protein],
            ["Carbs", split.carbs_pct, AMDR.carbs],
            ["Fat", split.fat_pct, AMDR.fat],
          ] as const
        ).map(([label, v, [lo, hi]]) => ({ label, value: v, max: 100, display: `${v}% (${lo}-${hi}%)`, tone: (v >= lo && v <= hi ? "good" : "warn") as Tone }))
      : [],
    empty: "No macro data logged yet.",
  });

  // ---------- calories by day ----------
  sections.push({
    title: "Calories by day",
    table: {
      columns: ["Date", "Calories", "Protein", "Carbs", "Fat", "Fiber", "Water", "Meals", "Goal"],
      rows: days.map((d) => {
        const c = calorieHit(d, goals);
        const p = proteinHit(d, goals);
        const status = c === null ? "-" : `${c ? "✓ kcal" : d.calories > goals!.calories! ? "▲ kcal" : "▼ kcal"}${p === null ? "" : p ? " · ✓ protein" : " · ▼ protein"}`;
        return [d.date, fmt(d.calories), `${fmt(d.protein_g)} g`, `${fmt(d.carbs_g)} g`, `${fmt(d.fat_g)} g`, `${fmt(d.fiber_g)} g`, waterMap.has(d.date) ? waterText(waterMap.get(d.date), units) : null, d.meals, status];
      }),
      numeric: [1, 2, 3, 4, 5, 6, 7],
    },
    empty: "No meals logged in this period.",
  });

  // ---------- meals by type ----------
  const typeCalories = byType.results.reduce((s, t) => s + t.calories, 0);
  sections.push({
    title: "Meals by type",
    bars: byType.results.map((t) => ({ label: t.meal_type, value: t.calories, max: typeCalories || 1, display: `${pct(t.calories, typeCalories)}% of calories` })),
    table: {
      columns: ["Type", "Meals", "Avg calories", "Avg protein", "Share of calories"],
      rows: byType.results.map((t) => [t.meal_type, t.meals, fmt(Math.round(t.calories / t.meals)), `${fmt(round(t.protein / t.meals, 1))} g`, `${pct(t.calories, typeCalories)}%`]),
      numeric: [1, 2, 3, 4],
    },
    empty: "No meals logged in this period.",
  });

  // ---------- top foods ----------
  sections.push({
    title: "Top foods",
    table: {
      columns: ["Food", "Times", "Total calories", "Avg calories"],
      rows: foods.map((f) => [f.name, f.times, fmt(Math.round(f.total_calories)), fmt(Math.round(f.avg_calories))]),
      numeric: [1, 2, 3],
    },
    empty: "No foods logged in this period.",
  });

  // ---------- highest-calorie meals ----------
  sections.push({
    title: "Highest-calorie meals",
    table: {
      columns: ["Date", "Time", "Type", "Meal", "Calories", "Protein"],
      rows: biggest.results.map((m) => [m.date, m.time, m.meal_type, m.name ?? m.items, fmt(Math.round(m.calories)), `${fmt(round(m.protein, 1))} g`]),
      numeric: [4, 5],
    },
    empty: "No meals logged in this period.",
  });

  // ---------- hydration ----------
  const waterGoal = goals?.water_ml ?? null;
  const waterHits = waterGoal ? water.filter((w) => w.ml >= waterGoal).length : null;
  sections.push({
    title: "Hydration",
    kpis: water.length
      ? [
          { label: "Average per day", value: waterText(avgWater, units), detail: `${water.length} day${water.length === 1 ? "" : "s"} logged` },
          ...(waterGoal ? [{ label: "Goal reached", value: `${waterHits} / ${water.length} days`, tone: (waterHits! >= water.length * 0.7 ? "good" : "warn") as Tone }] : []),
          ...(prevWater.length ? [{ label: "vs previous period", value: change(avgWater, prevAvgWater) }] : []),
        ]
      : [],
    bars: water.map((w) => ({
      label: w.date,
      value: w.ml,
      max: Math.max(waterGoal ?? 0, ...water.map((x) => x.ml)),
      display: waterText(w.ml, units),
      tone: waterGoal ? (w.ml >= waterGoal ? "good" : w.ml >= waterGoal * 0.7 ? "warn" : "bad") : undefined,
    })),
    empty: "No water logged in this period.",
  });

  // ---------- weight ----------
  const w = weights.results;
  const wu = weightUnit(units);
  const wChange = w.length >= 2 ? w[w.length - 1].weight_kg - w[0].weight_kg : null;
  const wSpan = w.length >= 2 ? daysBetween(w[0].date, w[w.length - 1].date) : 0;
  sections.push({
    title: "Weight trend",
    kpis: w.length
      ? [
          { label: "Start", value: `${weightOut(w[0].weight_kg, units)} ${wu}`, detail: w[0].date },
          { label: "Latest", value: `${weightOut(w[w.length - 1].weight_kg, units)} ${wu}`, detail: w[w.length - 1].date },
          ...(wChange !== null
            ? [
                { label: "Change", value: `${wChange > 0 ? "+" : ""}${weightOut(wChange, units)} ${wu}` },
                ...(wSpan ? [{ label: "Per week", value: `${wChange > 0 ? "+" : ""}${round(weightOut(wChange, units) / (wSpan / 7), 2)} ${wu}` }] : []),
              ]
            : []),
        ]
      : [],
    table: { columns: ["Date", "Weight"], rows: w.map((x) => [x.date, `${weightOut(x.weight_kg, units)} ${wu}`]), numeric: [1] },
    empty: "No weight entries in this period.",
  });

  // ---------- mood & energy ----------
  const r = ratings.results;
  const avgOf = (rows: typeof r, f: (x: (typeof r)[number]) => number | null) => {
    const v = rows.map(f).filter((x): x is number => x !== null);
    return v.length ? round(v.reduce((s, x) => s + x, 0) / v.length, 1) : null;
  };
  const moodRows = [1, 2, 3, 4, 5]
    .map((n) => {
      const mood = r.filter((x) => x.mood === n);
      const energy = r.filter((x) => x.energy === n);
      const hunger = r.filter((x) => x.hunger === n);
      return [n, mood.length, mood.length ? fmt(Math.round(mood.reduce((s, x) => s + x.calories, 0) / mood.length)) : null, energy.length, energy.length ? fmt(Math.round(energy.reduce((s, x) => s + x.calories, 0) / energy.length)) : null, hunger.length, hunger.length ? fmt(Math.round(hunger.reduce((s, x) => s + x.calories, 0) / hunger.length)) : null];
    })
    .filter((row) => row[1] || row[3] || row[5]);
  const moodBullets: string[] = [];
  if (r.length >= 4) {
    const sweet = r.filter((x) => x.sugar >= 25);
    const other = r.filter((x) => x.sugar < 25);
    const eS = avgOf(sweet, (x) => x.energy);
    const eO = avgOf(other, (x) => x.energy);
    if (eS !== null && eO !== null && sweet.length >= 2 && other.length >= 2) moodBullets.push(`Energy after high-sugar meals (≥25 g): ${eS}/5 vs ${eO}/5 after other meals.`);
    const median = [...r].sort((a, b) => a.calories - b.calories)[Math.floor(r.length / 2)].calories;
    const big = r.filter((x) => x.calories >= median);
    const small = r.filter((x) => x.calories < median);
    const mB = avgOf(big, (x) => x.mood);
    const mS = avgOf(small, (x) => x.mood);
    if (mB !== null && mS !== null) moodBullets.push(`Mood after larger meals: ${mB}/5 vs ${mS}/5 after smaller ones.`);
    const hungry = r.filter((x) => (x.hunger ?? 0) >= 4);
    const calm = r.filter((x) => x.hunger !== null && x.hunger <= 2);
    if (hungry.length && calm.length)
      moodBullets.push(`Meals eaten very hungry (4-5) averaged ${kcal(hungry.reduce((s, x) => s + x.calories, 0) / hungry.length)} vs ${kcal(calm.reduce((s, x) => s + x.calories, 0) / calm.length)} when barely hungry.`);
  }
  sections.push({
    title: "Mood & energy",
    text: r.length ? `${r.length} rated meal${r.length === 1 ? "" : "s"}. Average mood ${avgOf(r, (x) => x.mood) ?? "-"}/5, energy ${avgOf(r, (x) => x.energy) ?? "-"}/5.` : undefined,
    table: { columns: ["Rating", "Mood: meals", "Mood: avg kcal", "Energy: meals", "Energy: avg kcal", "Hunger: meals", "Hunger: avg kcal"], rows: moodRows, numeric: [1, 2, 3, 4, 5, 6] },
    bullets: moodBullets,
    empty: "No mood, energy or hunger ratings logged, add them to meals to spot patterns.",
  });

  // ---------- patterns ----------
  sections.push({
    title: "Patterns",
    bullets: days.length ? patterns_notes(pats, days.length, goals, true) : [],
    empty: "No notable patterns in this period.",
  });

  const calTone = tone(avg.calories, goals?.calories ?? null, "target") ?? "neutral";
  return {
    tool: TOOLS.food.name,
    title: "Nutrition Report",
    subtitle: user.name ?? user.email,
    period: { from: range.from, to: range.to, label: range.label },
    kpis: [
      {
        label: "Avg calories / day",
        value: days.length ? kcal(avg.calories) : "-",
        detail: [goals?.calories ? `goal ${fmt(goals.calories)}` : null, prevDays.length && days.length ? `${change(avg.calories, prevAvg.calories)} vs prev.` : null].filter(Boolean).join(" · ") || undefined,
        tone: days.length ? calTone : "neutral",
      },
      {
        label: "Avg protein",
        value: days.length ? `${fmt(avg.protein_g)} g` : "-",
        detail: goals?.protein_g ? `goal ${fmt(goals.protein_g)} g` : undefined,
        tone: days.length ? (tone(avg.protein_g, goals?.protein_g ?? null, "min") ?? "neutral") : "neutral",
      },
      { label: "Days logged", value: `${days.length} / ${Math.max(elapsedDays, days.length)}`, tone: elapsedDays && days.length >= elapsedDays * 0.8 ? "good" : "warn" },
      {
        label: "Goal-hit rate",
        value: hits.calorie_hit_rate === null ? "-" : `${hits.calorie_hit_rate}%`,
        detail: hits.calorie_hit_rate === null ? (goals?.calories ? "no days logged" : "no calorie goal") : "calories within ±10%",
        tone: hits.calorie_hit_rate === null ? "neutral" : hits.calorie_hit_rate >= 70 ? "good" : hits.calorie_hit_rate >= 40 ? "warn" : "bad",
      },
      {
        label: "Avg water",
        value: water.length ? waterText(avgWater, units) : "-",
        detail: goals?.water_ml ? `goal ${waterText(goals.water_ml, units)}` : undefined,
        tone: water.length ? (tone(avgWater, goals?.water_ml ?? null, "min") ?? "neutral") : "neutral",
      },
    ],
    highlights,
    sections,
    disclaimer: "Values marked as estimates are AI approximations from typical recipes and portions. This report is for personal tracking, not medical or dietary advice.",
  };
}

/** Plain sentences describing eating patterns in the period. */
function patterns_notes(p: Awaited<ReturnType<typeof patterns>>, daysLogged: number, goals: GoalsRow | null, full = false): string[] {
  const out: string[] = [];
  if (p.late_night_days) out.push(`Late-night eating on ${p.late_night_days} day${p.late_night_days === 1 ? "" : "s"}.`);
  if (p.low_fiber_days.length) out.push(`Low fiber on ${p.low_fiber_days.length} of ${daysLogged} logged days.`);
  if (p.high_sodium_days.length) out.push(`High sodium (above ${fmt(goals?.sodium_max_mg ?? 2300)} mg) on ${p.high_sodium_days.length} day${p.high_sodium_days.length === 1 ? "" : "s"}.`);
  if (full && !out.length) out.push("No late-night eating, low-fiber or high-sodium days detected.");
  return out;
}

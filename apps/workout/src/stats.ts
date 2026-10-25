import { addDays, daysBetween, round, startOfWeek, type Units } from "@quemo/core";

// ---------- units: stored metric (kg, km, cm), shown in the user's units ----------

export const KG_PER_LB = 0.45359237;
export const KM_PER_MI = 1.609344;
export const CM_PER_IN = 2.54;

export const weightUnit = (u: Units) => (u === "imperial" ? "lb" : "kg");
export const distanceUnit = (u: Units) => (u === "imperial" ? "mi" : "km");
export const lengthUnit = (u: Units) => (u === "imperial" ? "in" : "cm");

export const toKg = (v: number, u: Units) => (u === "imperial" ? v * KG_PER_LB : v);
export const fromKg = (kg: number, u: Units, digits = 1) => round(u === "imperial" ? kg / KG_PER_LB : kg, digits);
export const toKm = (v: number, u: Units) => (u === "imperial" ? v * KM_PER_MI : v);
export const fromKm = (km: number, u: Units, digits = 2) => round(u === "imperial" ? km / KM_PER_MI : km, digits);
export const toCm = (v: number, u: Units) => (u === "imperial" ? v * CM_PER_IN : v);
export const fromCm = (cm: number, u: Units, digits = 1) => round(u === "imperial" ? cm / CM_PER_IN : cm, digits);

export const fmtWeight = (kg: number, u: Units) => `${fromKg(kg, u)} ${weightUnit(u)}`;
export const fmtVolume = (kg: number, u: Units) => `${Math.round(fromKg(kg, u, 0)).toLocaleString("en")} ${weightUnit(u)}`;
export const fmtDistance = (km: number, u: Units) => `${fromKm(km, u)} ${distanceUnit(u)}`;

export function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Pace is stored as seconds per km; shown per km or per mile. */
export const paceFor = (secPerKm: number, u: Units) => (u === "imperial" ? secPerKm * KM_PER_MI : secPerKm);
export const fmtPace = (secPerKm: number, u: Units) => `${fmtDuration(paceFor(secPerKm, u))} /${distanceUnit(u)}`;

// ---------- body metrics ----------

export const METRICS = ["weight", "body_fat_pct", "waist", "chest", "arms", "thighs", "hips", "neck", "resting_hr"] as const;
export type Metric = (typeof METRICS)[number];
const LENGTHS: Metric[] = ["waist", "chest", "arms", "thighs", "hips", "neck"];

export const METRIC_LABELS: Record<Metric, string> = {
  weight: "Body weight",
  body_fat_pct: "Body fat",
  waist: "Waist",
  chest: "Chest",
  arms: "Arms",
  thighs: "Thighs",
  hips: "Hips",
  neck: "Neck",
  resting_hr: "Resting HR",
};

export const metricUnit = (m: Metric, u: Units) => (m === "weight" ? weightUnit(u) : m === "body_fat_pct" ? "%" : m === "resting_hr" ? "bpm" : lengthUnit(u));
export const metricToStored = (m: Metric, v: number, u: Units) => (m === "weight" ? toKg(v, u) : LENGTHS.includes(m) ? toCm(v, u) : v);
export const metricFromStored = (m: Metric, v: number, u: Units) => (m === "weight" ? fromKg(v, u) : LENGTHS.includes(m) ? fromCm(v, u) : round(v, 1));
export const fmtMetric = (m: Metric, v: number, u: Units) => `${metricFromStored(m, v, u)}${metricUnit(m, u) === "%" ? "%" : ` ${metricUnit(m, u)}`}`;

// ---------- strength math ----------

/** Estimated one-rep max (Epley): w × (1 + reps / 30). A single is its own 1RM. */
export function e1rm(weight: number | null | undefined, reps: number | null | undefined): number {
  if (!weight || !reps || reps <= 0) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

// ---------- muscle-group / type inference for auto-created exercises ----------

const GROUP_HINTS: [RegExp, string][] = [
  [/run|jog|row(ing|er)|bike|cycl|spin|swim|elliptical|stair|walk|hike|treadmill|skip|jump rope|cardio/, "cardio"],
  [/bench|chest|pec|fly|flye|push[- ]?up|dip/, "chest"],
  [/squat|leg press|lunge|leg ext|leg curl|calf|hamstring|quad|step[- ]?up|rdl|romanian|split squat/, "legs"],
  [/deadlift|pull[- ]?up|chin[- ]?up|lat |pulldown|pull-down|row|back ext|shrug/, "back"],
  [/hip thrust|glute|bridge/, "glutes"],
  [/tricep|skull|pushdown|kickback|close[- ]grip/, "triceps"],
  [/overhead|ohp|shoulder|military|lateral raise|front raise|face pull|delt|arnold/, "shoulders"],
  [/curl/, "biceps"],
  [/plank|crunch|sit[- ]?up|ab |abs|core|leg raise|russian twist|hollow|pallof/, "core"],
  [/burpee|clean|snatch|thruster|kettlebell swing|swing/, "full_body"],
];

export function guessMuscleGroup(name: string): string | null {
  const n = ` ${name.toLowerCase()} `;
  for (const [re, g] of GROUP_HINTS) if (re.test(n)) return g;
  return null;
}

export function guessEquipment(name: string): string | null {
  const n = name.toLowerCase();
  if (/dumbbell|\bdb\b/.test(n)) return "dumbbell";
  if (/barbell|\bbb\b|bench press|deadlift|back squat|front squat|ohp|overhead press/.test(n)) return "barbell";
  if (/kettlebell|\bkb\b/.test(n)) return "kettlebell";
  if (/cable|pulldown|pushdown|face pull/.test(n)) return "cable";
  if (/machine|leg press|smith|leg ext|leg curl/.test(n)) return "machine";
  if (/push[- ]?up|pull[- ]?up|chin[- ]?up|dip|plank|burpee|sit[- ]?up|crunch/.test(n)) return "bodyweight";
  return null;
}

// ---------- set rows and per-session summaries ----------

export interface SetRow {
  id: string;
  workout_id: string;
  workout: string;
  exercise_id: string;
  exercise: string;
  muscle_group: string | null;
  type: string;
  date: string;
  position: number;
  set_number: number;
  reps: number | null;
  weight_kg: number | null;
  rpe: number | null;
  distance_km: number | null;
  duration_sec: number | null;
  is_warmup: number;
}

export async function loadSets(db: D1Database, uid: string, opts: { from?: string; to?: string; exerciseId?: string; workoutId?: string } = {}): Promise<SetRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id, s.workout_id, w.name AS workout, s.exercise_id, e.name AS exercise, e.muscle_group, e.type, w.date, s.position, s.set_number,
              s.reps, s.weight_kg, s.rpe, s.distance_km, s.duration_sec, s.is_warmup
       FROM workout_sets s JOIN workouts w ON w.id = s.workout_id JOIN exercises e ON e.id = s.exercise_id
       WHERE s.user_id = ?1 AND w.user_id = ?1 AND (?2 IS NULL OR w.date >= ?2) AND (?3 IS NULL OR w.date <= ?3)
         AND (?4 IS NULL OR s.exercise_id = ?4) AND (?5 IS NULL OR s.workout_id = ?5)
       ORDER BY w.date, COALESCE(w.start_time, ''), w.created_at, s.position, s.set_number`,
    )
    .bind(uid, opts.from ?? null, opts.to ?? null, opts.exerciseId ?? null, opts.workoutId ?? null)
    .all<SetRow>();
  return results;
}

interface SetRef {
  weight: number;
  reps: number;
}

/** What one exercise looked like in one workout (working sets only). */
export interface ExerciseSession {
  workout_id: string;
  workout: string;
  date: string;
  exercise_id: string;
  exercise: string;
  muscle_group: string | null;
  type: string;
  sets: number;
  warmup_sets: number;
  reps: number;
  volume_kg: number;
  top_weight: number;
  top_set: SetRef | null;
  best_e1rm: number;
  e1rm_set: SetRef | null;
  best_set_volume: number;
  volume_set: SetRef | null;
  max_reps: number;
  max_reps_weight: number;
  /** weight (kg, rounded to grams) → most reps done at that weight */
  reps_by_weight: Map<number, number>;
  distance_km: number;
  max_distance: number;
  duration_sec: number;
  max_duration: number;
  /** seconds per km of the fastest set with both distance and duration; 0 = none */
  best_pace: number;
  avg_rpe: number | null;
}

export const wKey = (kg: number) => Math.round(kg * 1000) / 1000;

export function summarize(rows: SetRow[]): ExerciseSession[] {
  const map = new Map<string, ExerciseSession>();
  const rpe = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.workout_id}|${r.exercise_id}`;
    let s = map.get(key);
    if (!s) {
      s = {
        workout_id: r.workout_id,
        workout: r.workout,
        date: r.date,
        exercise_id: r.exercise_id,
        exercise: r.exercise,
        muscle_group: r.muscle_group,
        type: r.type,
        sets: 0,
        warmup_sets: 0,
        reps: 0,
        volume_kg: 0,
        top_weight: 0,
        top_set: null,
        best_e1rm: 0,
        e1rm_set: null,
        best_set_volume: 0,
        volume_set: null,
        max_reps: 0,
        max_reps_weight: 0,
        reps_by_weight: new Map(),
        distance_km: 0,
        max_distance: 0,
        duration_sec: 0,
        max_duration: 0,
        best_pace: 0,
        avg_rpe: null,
      };
      map.set(key, s);
    }
    if (r.is_warmup) {
      s.warmup_sets++;
      continue;
    }
    s.sets++;
    const w = r.weight_kg ?? 0;
    const reps = r.reps ?? 0;
    s.reps += reps;
    s.volume_kg += w * reps;
    if (w > s.top_weight || (w === s.top_weight && w > 0 && reps > (s.top_set?.reps ?? 0))) {
      s.top_weight = w;
      s.top_set = { weight: w, reps };
    }
    const est = e1rm(w, reps);
    if (est > s.best_e1rm) {
      s.best_e1rm = est;
      s.e1rm_set = { weight: w, reps };
    }
    if (w * reps > s.best_set_volume) {
      s.best_set_volume = w * reps;
      s.volume_set = { weight: w, reps };
    }
    if (reps > s.max_reps) {
      s.max_reps = reps;
      s.max_reps_weight = w;
    }
    if (reps > 0) {
      const k = wKey(w);
      s.reps_by_weight.set(k, Math.max(s.reps_by_weight.get(k) ?? 0, reps));
    }
    const d = r.distance_km ?? 0;
    const t = r.duration_sec ?? 0;
    s.distance_km += d;
    s.duration_sec += t;
    s.max_distance = Math.max(s.max_distance, d);
    s.max_duration = Math.max(s.max_duration, t);
    if (d > 0 && t > 0) {
      const pace = t / d;
      if (!s.best_pace || pace < s.best_pace) s.best_pace = pace;
    }
    if (r.rpe) rpe.set(key, [...(rpe.get(key) ?? []), r.rpe]);
  }
  for (const [key, list] of rpe) map.get(key)!.avg_rpe = round(list.reduce((a, b) => a + b, 0) / list.length, 1);
  return [...map.values()];
}

// ---------- personal records ----------

export type PrKind = "heaviest_weight" | "best_e1rm" | "best_set_volume" | "most_reps_at_weight" | "longest_distance" | "longest_duration" | "fastest_pace";

export const PR_LABELS: Record<PrKind, string> = {
  heaviest_weight: "Heaviest weight",
  best_e1rm: "Best estimated 1RM",
  best_set_volume: "Best set volume",
  most_reps_at_weight: "Most reps",
  longest_distance: "Longest distance",
  longest_duration: "Longest duration",
  fastest_pace: "Fastest pace",
};

export interface PrEvent {
  exercise_id: string;
  exercise: string;
  workout_id: string;
  date: string;
  kind: PrKind;
  /** Canonical value (kg, kg·reps, reps, km, seconds, seconds per km). */
  value: number;
  previous: number;
  /** For most_reps_at_weight: the weight in kg. */
  weight?: number;
  /** For weight records: reps of that set. */
  reps?: number;
}

/**
 * Walks sessions chronologically and emits an event whenever a session beats the exercise's previous best.
 * The very first session of an exercise sets the baseline and is not counted as a PR.
 */
export function prEvents(sessions: ExerciseSession[]): PrEvent[] {
  const best = new Map<string, Partial<Record<PrKind, number>>>();
  const repsAt = new Map<string, Map<number, number>>();
  const events: PrEvent[] = [];
  for (const s of sessions) {
    if (!s.sets) continue;
    const b = best.get(s.exercise_id) ?? {};
    const base = { exercise_id: s.exercise_id, exercise: s.exercise, workout_id: s.workout_id, date: s.date };
    const candidates: [PrKind, number, boolean, number | undefined][] = [
      ["heaviest_weight", s.top_weight, true, s.top_set?.reps],
      ["best_e1rm", s.best_e1rm, true, s.e1rm_set?.reps],
      ["best_set_volume", s.best_set_volume, true, s.volume_set?.reps],
      ["longest_distance", s.max_distance, true, undefined],
      ["longest_duration", s.max_duration, true, undefined],
      ["fastest_pace", s.best_pace, false, undefined],
    ];
    for (const [kind, value, higher, reps] of candidates) {
      if (!(value > 0)) continue;
      const prev = b[kind];
      const better = prev === undefined || (higher ? value > prev + 1e-9 : value < prev - 1e-9);
      if (prev !== undefined && better) events.push({ ...base, kind, value, previous: prev, ...(reps !== undefined ? { reps } : {}) });
      if (better) b[kind] = value;
    }
    const ra = repsAt.get(s.exercise_id) ?? new Map<number, number>();
    for (const [w, reps] of s.reps_by_weight) {
      const prev = ra.get(w);
      if (prev !== undefined && reps > prev) events.push({ ...base, kind: "most_reps_at_weight", value: reps, previous: prev, weight: w });
      ra.set(w, Math.max(prev ?? 0, reps));
    }
    repsAt.set(s.exercise_id, ra);
    best.set(s.exercise_id, b);
  }
  return events;
}

export function describePr(e: PrEvent, u: Units): string {
  const v = prValue(e.kind, e.value, u, e.weight);
  const p = prValue(e.kind, e.previous, u, e.weight);
  const at = e.kind === "most_reps_at_weight" ? (e.weight ? ` at ${fmtWeight(e.weight, u)}` : " (bodyweight)") : "";
  const reps = (e.kind === "heaviest_weight" || e.kind === "best_e1rm") && e.reps ? ` (${e.reps} rep${e.reps === 1 ? "" : "s"})` : "";
  const name = PR_LABELS[e.kind].charAt(0).toLowerCase() + PR_LABELS[e.kind].slice(1);
  return `${e.exercise}: ${name}${at} ${v}${reps}, previous ${p}`;
}

export function prValue(kind: PrKind, v: number, u: Units, _weight?: number): string {
  switch (kind) {
    case "heaviest_weight":
    case "best_e1rm":
      return fmtWeight(v, u);
    case "best_set_volume":
      return fmtVolume(v, u);
    case "most_reps_at_weight":
      return `${v} reps`;
    case "longest_distance":
      return fmtDistance(v, u);
    case "longest_duration":
      return fmtDuration(v);
    case "fastest_pace":
      return fmtPace(v, u);
  }
}

/** All-time bests per exercise, with the set and date each came from. */
export function records(sessions: ExerciseSession[], u: Units) {
  type Rec = { value: number; date: string; set?: SetRef };
  type Acc = { exercise: string; muscle_group: string | null; type: string; sessions: number; last_date: string; recs: Partial<Record<PrKind | "most_reps", Rec>>; repsAt: Map<number, Rec> };
  const per = new Map<string, Acc>();
  for (const s of sessions) {
    if (!s.sets) continue;
    const p: Acc = per.get(s.exercise_id) ?? { exercise: s.exercise, muscle_group: s.muscle_group, type: s.type, sessions: 0, last_date: s.date, recs: {}, repsAt: new Map() };
    p.sessions++;
    p.last_date = s.date;
    const upd = (k: PrKind | "most_reps", value: number, set?: SetRef | null, lower = false) => {
      if (!(value > 0)) return;
      const cur = p.recs[k];
      if (!cur || (lower ? value < cur.value : value > cur.value)) p.recs[k] = { value, date: s.date, set: set ?? undefined };
    };
    upd("heaviest_weight", s.top_weight, s.top_set);
    upd("best_e1rm", s.best_e1rm, s.e1rm_set);
    upd("best_set_volume", s.best_set_volume, s.volume_set);
    upd("most_reps", s.max_reps, { weight: s.max_reps_weight, reps: s.max_reps });
    upd("longest_distance", s.max_distance);
    upd("longest_duration", s.max_duration);
    upd("fastest_pace", s.best_pace, null, true);
    for (const [w, reps] of s.reps_by_weight) {
      const cur = p.repsAt.get(w);
      if (!cur || reps > cur.value) p.repsAt.set(w, { value: reps, date: s.date });
    }
    per.set(s.exercise_id, p);
  }
  const set = (x?: SetRef) => (x ? { weight: fromKg(x.weight, u), reps: x.reps } : undefined);
  return [...per.values()]
    .map((p) => {
      const r = p.recs;
      const out: Record<string, unknown> = { exercise: p.exercise, muscle_group: p.muscle_group, type: p.type, sessions: p.sessions, last_done: p.last_date };
      if (r.heaviest_weight) out.heaviest_weight = { weight: fromKg(r.heaviest_weight.value, u), reps: r.heaviest_weight.set?.reps, date: r.heaviest_weight.date };
      if (r.best_e1rm) out.best_e1rm = { e1rm: fromKg(r.best_e1rm.value, u), set: set(r.best_e1rm.set), date: r.best_e1rm.date };
      if (r.best_set_volume) out.best_set_volume = { volume: fromKg(r.best_set_volume.value, u, 0), set: set(r.best_set_volume.set), date: r.best_set_volume.date };
      if (r.most_reps) out.most_reps = { reps: r.most_reps.value, weight: r.most_reps.set?.weight ? fromKg(r.most_reps.set.weight, u) : null, date: r.most_reps.date };
      if (p.repsAt.size > 1 || (p.repsAt.size === 1 && !p.repsAt.has(0)))
        out.most_reps_by_weight = [...p.repsAt]
          .sort((a, b) => b[0] - a[0])
          .slice(0, 10)
          .map(([w, rec]) => ({ weight: fromKg(w, u), reps: rec.value, date: rec.date }));
      if (r.longest_distance) out.longest_distance = { distance: fromKm(r.longest_distance.value, u), date: r.longest_distance.date };
      if (r.longest_duration) out.longest_duration = { duration: fmtDuration(r.longest_duration.value), seconds: r.longest_duration.value, date: r.longest_duration.date };
      if (r.fastest_pace) out.fastest_pace = { pace: fmtPace(r.fastest_pace.value, u), date: r.fastest_pace.date };
      return out;
    })
    .sort((a, b) => String(a.exercise).localeCompare(String(b.exercise)));
}

// ---------- progress ----------

export type Trend = "improving" | "declining" | "stable" | "not enough data";

export function trendOf(first: number, last: number, count: number, lowerIsBetter = false): Trend {
  if (count < 2 || !first) return "not enough data";
  const pct = ((last - first) / first) * 100 * (lowerIsBetter ? -1 : 1);
  return pct > 1 ? "improving" : pct < -1 ? "declining" : "stable";
}

export const pctChange = (first: number, last: number) => (first ? round(((last - first) / first) * 100, 1) : null);

/** The value that defines "better" for an exercise: e1RM for lifts, distance for cardio, reps for bodyweight work. */
export function headline(s: ExerciseSession): { metric: "e1rm" | "distance" | "reps" | "duration"; value: number } {
  if (s.best_e1rm > 0) return { metric: "e1rm", value: s.best_e1rm };
  if (s.max_distance > 0) return { metric: "distance", value: s.max_distance };
  if (s.max_reps > 0) return { metric: "reps", value: s.max_reps };
  return { metric: "duration", value: s.max_duration };
}

// ---------- weeks, streaks ----------

/** Number of workouts per ISO week (keyed by Monday). */
export async function weeklyCounts(db: D1Database, uid: string, from: string, to: string) {
  const { results } = await db
    .prepare(
      `SELECT date(date, '-' || ((CAST(strftime('%w', date) AS INTEGER) + 6) % 7) || ' days') AS week, COUNT(*) AS n,
              COALESCE(SUM(duration_min), 0) AS minutes
       FROM workouts WHERE user_id = ? AND date BETWEEN ? AND ? GROUP BY week`,
    )
    .bind(uid, from, to)
    .all<{ week: string; n: number; minutes: number }>();
  return new Map(results.map((r) => [r.week, r]));
}

export async function streaks(db: D1Database, uid: string, today: string, weeklyTarget: number) {
  const thisWeek = startOfWeek(today);
  const counts = await weeklyCounts(db, uid, addDays(thisWeek, -7 * 104), today);
  const met = (w: string) => (counts.get(w)?.n ?? 0) >= weeklyTarget;
  let weeks = 0;
  let w = met(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  while (met(w)) {
    weeks++;
    w = addDays(w, -7);
  }
  const { results } = await db
    .prepare("SELECT DISTINCT date FROM workouts WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC")
    .bind(uid, addDays(today, -400), today)
    .all<{ date: string }>();
  const dates = new Set(results.map((r) => r.date));
  let days = 0;
  let d = dates.has(today) ? today : addDays(today, -1);
  while (dates.has(d)) {
    days++;
    d = addDays(d, -1);
  }
  return { weeks, days, weekly_target: weeklyTarget, this_week: counts.get(thisWeek)?.n ?? 0, current_week_met: met(thisWeek) };
}

export const daysAgo = (date: string, today: string) => daysBetween(date, today);

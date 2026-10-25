import {
  addDays,
  createToolServer,
  daysBetween,
  fail,
  id,
  localDate,
  ok,
  PERIODS,
  reportResult,
  resolvePeriod,
  round,
  startOfWeek,
  weekday,
  WEEKDAYS,
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
import {
  describePr,
  distanceUnit,
  fmtDistance,
  fmtDuration,
  fmtMetric,
  fmtPace,
  fmtVolume,
  fmtWeight,
  fromKg,
  fromKm,
  guessEquipment,
  guessMuscleGroup,
  headline,
  loadSets,
  metricFromStored,
  metricToStored,
  metricUnit,
  METRICS,
  METRIC_LABELS,
  pctChange,
  prEvents,
  records,
  streaks,
  summarize,
  toKg,
  toKm,
  trendOf,
  weightUnit,
  type ExerciseSession,
  type Metric,
  type PrEvent,
} from "./stats";

export type Env = ToolEnv;

export const EXERCISE_TYPES = ["strength", "cardio", "mobility", "sport"] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];
export const GOAL_TYPES = ["workouts_per_week", "minutes_per_week", "total_volume_per_week", "exercise_weight", "exercise_reps", "body_weight", "body_fat_pct"] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

const exName = z.string().trim().min(1).max(80);
const label = z.string().trim().min(1).max(30);
const norm = (s: string | undefined | null) => (s ? s.trim().toLowerCase() : null);

export interface ExerciseRow {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  type: ExerciseType;
}

export interface WorkoutSummaryRow {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  duration_min: number | null;
  effort: number | null;
  notes: string | null;
  routine: string | null;
  exercises: number;
  sets: number;
  volume_kg: number;
  muscle_groups: string | null;
}

export function buildServer(ctx: ToolContext<Env>): McpServer {
  const { env, user } = ctx;
  const db = env.DB;
  const uid = user.id;
  const units = (): Units => user.units;
  const wu = () => weightUnit(units());
  const today = () => localDate(user.timezone);

  const server = createToolServer(ctx, {
    name: "quemo-workout",
    instructions:
      "Quemo Workout: gym & training log the user drives from chat. Turn natural phrases into tool calls: " +
      "'bench 4x8 at 70' → log_workout with exercises [{exercise: 'Bench Press', sets: [{reps: 8, weight: 70, count: 4}]}]; " +
      "'ran 5k in 25 min' → log_workout with a cardio exercise and a set {distance: 5, duration_sec: 1500}. " +
      "Log a whole session in ONE log_workout call (every exercise, in order); use add_sets to append to an existing workout (ids from list_workouts). " +
      "Weights and distances are in the user's units (kg/km for metric, lb/mi for imperial), never convert them yourself. Warm-up sets get is_warmup: true (excluded from volume and PRs). " +
      "Exercises are created on first use: reuse names from list_exercises when they match, use clear full names (e.g. 'Barbell Back Squat'), and pass muscle_group/type when you know them. " +
      "Always celebrate new PRs that log_workout returns. 'Do my Push day' → start_routine_workout to show the plan with last numbers; when done, log it with log_workout (routine: 'Push day') or start_routine_workout with log: true if done exactly as planned. " +
      "Body weight & measurements → log_body_metric. Targets → set_goal. 'How am I doing?' → follow_up; progress on a lift → exercise_progress; records → personal_records.",
  });

  // ---------- exercises ----------

  const getExercise = (name: string) =>
    db.prepare("SELECT id, name, muscle_group, equipment, type FROM exercises WHERE user_id = ? AND name = ?").bind(uid, name.trim()).first<ExerciseRow>();

  /** Exact (case-insensitive) match first, then a unique partial match ("bench" → "Bench Press"). */
  async function findExercise(name: string): Promise<ExerciseRow | string> {
    const exact = await getExercise(name);
    if (exact) return exact;
    const { results } = await db
      .prepare("SELECT id, name, muscle_group, equipment, type FROM exercises WHERE user_id = ? AND name LIKE '%' || ? || '%' ORDER BY length(name) LIMIT 6")
      .bind(uid, name.trim())
      .all<ExerciseRow>();
    if (results.length === 1) return results[0];
    if (results.length > 1) return `Several exercises match "${name}": ${results.map((r) => r.name).join(", ")}. Which one?`;
    return `No exercise named "${name}" yet, list_exercises shows what has been logged.`;
  }

  async function exerciseId(name: string, hints: { muscle_group?: string; equipment?: string; type?: ExerciseType } = {}, inferred?: ExerciseType): Promise<string> {
    const found = await getExercise(name);
    if (found) {
      if (hints.muscle_group || hints.equipment || hints.type)
        await db
          .prepare("UPDATE exercises SET muscle_group = COALESCE(?, muscle_group), equipment = COALESCE(?, equipment), type = COALESCE(?, type) WHERE id = ?")
          .bind(norm(hints.muscle_group), norm(hints.equipment), hints.type ?? null, found.id)
          .run();
      return found.id;
    }
    const group = norm(hints.muscle_group) ?? guessMuscleGroup(name);
    const type = hints.type ?? (group === "cardio" ? "cardio" : inferred ?? "strength");
    const eid = id();
    await db
      .prepare("INSERT INTO exercises (id, user_id, name, muscle_group, equipment, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(eid, uid, name.trim(), group ?? (type === "cardio" ? "cardio" : null), norm(hints.equipment) ?? guessEquipment(name), type, Date.now())
      .run();
    return eid;
  }

  // ---------- sets ----------

  const setInput = z
    .object({
      reps: z.number().int().min(0).max(1000).optional(),
      weight: z.number().min(0).max(2000).optional().describe(`Load in ${wu()} (the user's units). Omit or 0 for bodyweight.`),
      rpe: z.number().min(1).max(10).optional().describe("Rate of perceived exertion 1-10"),
      distance: z.number().positive().max(1000).optional().describe(`Distance in ${distanceUnit(units())}`),
      duration_sec: z.number().int().positive().max(86_400).optional().describe("Duration of the set in seconds (cardio, planks…)"),
      is_warmup: z.boolean().default(false),
      count: z.number().int().min(1).max(20).default(1).describe("Repeat this identical set N times: '4x8 at 70' → reps 8, weight 70, count 4"),
    })
    .refine((s) => s.reps !== undefined || s.distance !== undefined || s.duration_sec !== undefined, "Each set needs reps, distance or duration_sec");

  const exerciseEntry = z.object({
    exercise: exName.describe("Exercise name, e.g. Bench Press, Barbell Back Squat, Running"),
    muscle_group: label.optional().describe("Primary muscle group: chest, back, shoulders, biceps, triceps, legs, glutes, core, full_body, cardio…"),
    equipment: label.optional().describe("barbell, dumbbell, machine, cable, kettlebell, bodyweight…"),
    type: z.enum(EXERCISE_TYPES).optional(),
    sets: z.array(setInput).min(1).max(50),
  });
  type Entry = z.infer<typeof exerciseEntry>;

  async function insertSets(workoutId: string, entries: Entry[]): Promise<number> {
    const total = entries.reduce((s, e) => s + e.sets.reduce((n, x) => n + x.count, 0), 0);
    if (total > 500) throw new Error(`Too many sets in one call (${total}); the limit is 500.`);
    const { results } = await db
      .prepare("SELECT exercise_id, MIN(position) AS position, MAX(set_number) AS n FROM workout_sets WHERE workout_id = ? GROUP BY exercise_id")
      .bind(workoutId)
      .all<{ exercise_id: string; position: number; n: number }>();
    const placed = new Map(results.map((r) => [r.exercise_id, { position: r.position, n: r.n }]));
    let nextPosition = results.reduce((m, r) => Math.max(m, r.position), 0) + 1;
    const stmts: D1PreparedStatement[] = [];
    const now = Date.now();
    for (const e of entries) {
      const cardio = e.sets.every((s) => s.reps === undefined && s.distance !== undefined);
      const eid = await exerciseId(e.exercise, e, cardio ? "cardio" : undefined);
      const slot = placed.get(eid) ?? { position: nextPosition++, n: 0 };
      placed.set(eid, slot);
      for (const s of e.sets)
        for (let k = 0; k < s.count; k++) {
          slot.n++;
          stmts.push(
            db
              .prepare(
                `INSERT INTO workout_sets (id, user_id, workout_id, exercise_id, position, set_number, reps, weight_kg, rpe, distance_km, duration_sec, is_warmup, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
              )
              .bind(
                id(),
                uid,
                workoutId,
                eid,
                slot.position,
                slot.n,
                s.reps ?? null,
                s.weight ? toKg(s.weight, units()) : null,
                s.rpe ?? null,
                s.distance !== undefined ? toKm(s.distance, units()) : null,
                s.duration_sec ?? null,
                s.is_warmup ? 1 : 0,
                now,
              ),
          );
        }
    }
    if (stmts.length) await db.batch(stmts);
    return stmts.length;
  }

  /** PRs this workout set, compared with every earlier session of the same exercises. */
  async function workoutPrs(workoutId: string): Promise<{ prs: PrEvent[]; firstTime: string[] }> {
    const { results } = await db.prepare("SELECT DISTINCT exercise_id FROM workout_sets WHERE workout_id = ? AND user_id = ?").bind(workoutId, uid).all<{ exercise_id: string }>();
    const prs: PrEvent[] = [];
    const firstTime: string[] = [];
    for (const r of results) {
      const sessions = summarize(await loadSets(db, uid, { exerciseId: r.exercise_id }));
      const worked = sessions.filter((s) => s.sets > 0);
      if (worked.length === 1 && worked[0].workout_id === workoutId) firstTime.push(worked[0].exercise);
      prs.push(...prEvents(sessions).filter((e) => e.workout_id === workoutId));
    }
    return { prs, firstTime };
  }

  const fmtSet = (s: { reps: number | null; weight_kg: number | null; distance_km: number | null; duration_sec: number | null }) => {
    const parts: string[] = [];
    if (s.reps !== null) parts.push(s.weight_kg ? `${fmtWeight(s.weight_kg, units())} × ${s.reps}` : `${s.reps} reps`);
    if (s.distance_km) parts.push(fmtDistance(s.distance_km, units()));
    if (s.duration_sec) parts.push(fmtDuration(s.duration_sec));
    return parts.join(" · ");
  };

  const bestSetText = (s: ExerciseSession) =>
    s.e1rm_set
      ? `${fmtWeight(s.e1rm_set.weight, units())} × ${s.e1rm_set.reps}`
      : s.max_distance
        ? fmtDistance(s.max_distance, units())
        : s.max_reps
          ? `${s.max_reps} reps`
          : s.max_duration
            ? fmtDuration(s.max_duration)
            : null;

  async function workoutDetail(workoutId: string) {
    const w = await db
      .prepare(
        `SELECT w.id, w.name, w.date, w.start_time, w.duration_min, w.effort, w.notes, r.name AS routine
         FROM workouts w LEFT JOIN routines r ON r.id = w.routine_id WHERE w.id = ? AND w.user_id = ?`,
      )
      .bind(workoutId, uid)
      .first<{ id: string; name: string; date: string; start_time: string | null; duration_min: number | null; effort: number | null; notes: string | null; routine: string | null }>();
    if (!w) return null;
    const rows = await loadSets(db, uid, { workoutId });
    const sessions = new Map(summarize(rows).map((s) => [s.exercise_id, s]));
    const exercises: Record<string, unknown>[] = [];
    let current: Record<string, unknown> & { sets: unknown[] } = { sets: [] };
    let currentId = "";
    for (const r of rows) {
      if (r.exercise_id !== currentId) {
        currentId = r.exercise_id;
        const s = sessions.get(r.exercise_id)!;
        current = {
          exercise: r.exercise,
          muscle_group: r.muscle_group,
          type: r.type,
          working_sets: s.sets,
          volume: fromKg(s.volume_kg, units(), 0),
          best_set: bestSetText(s),
          e1rm: s.best_e1rm ? fromKg(s.best_e1rm, units()) : null,
          sets: [],
        };
        exercises.push(current);
      }
      current.sets.push({
        id: r.id,
        set: r.set_number,
        ...(r.reps !== null ? { reps: r.reps } : {}),
        ...(r.weight_kg ? { weight: fromKg(r.weight_kg, units()) } : {}),
        ...(r.rpe !== null ? { rpe: r.rpe } : {}),
        ...(r.distance_km !== null ? { distance: fromKm(r.distance_km, units()) } : {}),
        ...(r.duration_sec !== null ? { duration_sec: r.duration_sec } : {}),
        ...(r.is_warmup ? { is_warmup: true } : {}),
        display: fmtSet(r),
      });
    }
    const all = [...sessions.values()];
    return {
      ...w,
      units: { weight: wu(), distance: distanceUnit(units()) },
      totals: {
        exercises: all.length,
        working_sets: all.reduce((n, s) => n + s.sets, 0),
        reps: all.reduce((n, s) => n + s.reps, 0),
        volume: fromKg(all.reduce((n, s) => n + s.volume_kg, 0), units(), 0),
        distance: fromKm(all.reduce((n, s) => n + s.distance_km, 0), units()),
      },
      exercises,
    };
  }

  const routineByName = (name: string) =>
    db.prepare("SELECT id, name, days, notes FROM routines WHERE user_id = ? AND name = ?").bind(uid, name.trim()).first<{ id: string; name: string; days: string | null; notes: string | null }>();

  const workoutMeta = {
    date: zDate.optional().describe("Defaults to today"),
    start_time: zTime.optional(),
    duration_min: z.number().int().min(1).max(1440).optional(),
    effort: z.number().int().min(1).max(10).optional().describe("Perceived effort of the whole session, 1 (easy) - 10 (max)"),
    notes: z.string().max(1000).optional(),
  };

  async function createWorkout(a: { name?: string; date?: string; start_time?: string; duration_min?: number; effort?: number; notes?: string }, routineId: string | null, entries: Entry[]) {
    const date = a.date ?? today();
    if (date > today()) throw new Error(`${date} is in the future, log workouts once they're done.`);
    const wid = id();
    await db
      .prepare(
        `INSERT INTO workouts (id, user_id, name, date, start_time, duration_min, effort, notes, routine_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(wid, uid, a.name?.trim() || "Workout", date, a.start_time ?? null, a.duration_min ?? null, a.effort ?? null, a.notes ?? null, routineId, Date.now())
      .run();
    try {
      await insertSets(wid, entries);
    } catch (err) {
      await db.batch([db.prepare("DELETE FROM workout_sets WHERE workout_id = ?").bind(wid), db.prepare("DELETE FROM workouts WHERE id = ?").bind(wid)]);
      throw err;
    }
    return wid;
  }

  async function loggedResult(wid: string, verb: string) {
    const detail = (await workoutDetail(wid))!;
    const { prs, firstTime } = await workoutPrs(wid);
    const prText = prs.map((p) => describePr(p, units()));
    const t = detail.totals;
    const parts = [`${t.exercises} exercise${t.exercises === 1 ? "" : "s"}`, `${t.working_sets} working sets`];
    if (t.volume) parts.push(`${fmtVolume(toKg(t.volume, units()), units())} volume`);
    if (detail.duration_min) parts.push(`${detail.duration_min} min`);
    let summary = `${verb} ${detail.name} on ${detail.date}: ${parts.join(", ")}.`;
    if (prs.length) summary += ` New PR${prs.length > 1 ? "s" : ""}! ${prText.join("; ")}.`;
    return ok({ workout: detail, new_prs: prText, first_time_exercises: firstTime }, summary);
  }

  server.registerTool(
    "log_workout",
    {
      title: "Log workout",
      description:
        "Log a whole training session in one call: name, date, optional start time, duration, perceived effort and notes, plus every exercise with its sets " +
        "(reps, weight, rpe, distance, duration_sec, is_warmup; use count for repeated identical sets). Exercises are auto-created. Returns the session and any new personal records.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(80).optional().describe("e.g. Push day, Leg day, Morning run. Defaults to the routine name or 'Workout'"),
        ...workoutMeta,
        routine: z.string().trim().min(1).max(80).optional().describe("Routine this session followed (from list_routines)"),
        exercises: z.array(exerciseEntry).max(50).default([]),
      }),
    },
    async (a) => {
      let routineId: string | null = null;
      let name = a.name;
      if (a.routine) {
        const r = await routineByName(a.routine);
        if (!r) return fail(`No routine named "${a.routine}", list_routines shows them.`);
        routineId = r.id;
        name ??= r.name;
      }
      if (!a.exercises.length && !a.duration_min) return fail("Add at least one exercise or a duration_min.");
      try {
        return await loggedResult(await createWorkout({ ...a, name }, routineId, a.exercises), "Logged");
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "add_sets",
    {
      title: "Add sets to a workout",
      description: "Append exercises/sets to an existing workout (id from log_workout or list_workouts). Sets of an exercise already in the workout continue its numbering.",
      inputSchema: z.object({ workout_id: z.string(), exercises: z.array(exerciseEntry).min(1).max(50) }),
    },
    async (a) => {
      const w = await db.prepare("SELECT id FROM workouts WHERE id = ? AND user_id = ?").bind(a.workout_id, uid).first();
      if (!w) return fail(`Workout ${a.workout_id} not found`);
      try {
        await insertSets(a.workout_id, a.exercises);
      } catch (err) {
        return fail((err as Error).message);
      }
      return loggedResult(a.workout_id, "Updated");
    },
  );

  server.registerTool(
    "list_workouts",
    {
      title: "List workouts",
      description: "Workouts newest first for a period, with exercises, working sets, volume and muscle groups. Optionally only those containing an exercise.",
      inputSchema: z.object({
        ...zPeriodInput,
        exercise: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      let exId: string | null = null;
      if (a.exercise) {
        const ex = await findExercise(a.exercise);
        if (typeof ex === "string") return fail(ex);
        exId = ex.id;
      }
      const rows = await workoutSummaries(db, uid, r.from, r.to, exId, a.limit);
      return ok({ period: r, count: rows.length, units: wu(), workouts: rows.map((w) => fmtSummary(w, units())) });
    },
  );

  server.registerTool(
    "get_workout",
    {
      title: "Get workout",
      description: "Full detail of one workout: every exercise and set (with set ids for delete_set / update_set), best sets, e1RM and totals.",
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const d = await workoutDetail(a.id);
      return d ? ok(d) : fail(`Workout ${a.id} not found`);
    },
  );

  server.registerTool(
    "update_workout",
    {
      title: "Update workout",
      description: "Change a workout's name, date, start time, duration, perceived effort or notes.",
      inputSchema: z.object({ id: z.string(), name: z.string().trim().min(1).max(80).optional(), ...workoutMeta }),
    },
    async (a) => {
      if (a.date && a.date > today()) return fail(`${a.date} is in the future.`);
      const res = await db
        .prepare(
          `UPDATE workouts SET name = COALESCE(?1, name), date = COALESCE(?2, date), start_time = COALESCE(?3, start_time), duration_min = COALESCE(?4, duration_min),
             effort = COALESCE(?5, effort), notes = COALESCE(?6, notes) WHERE id = ?7 AND user_id = ?8`,
        )
        .bind(a.name ?? null, a.date ?? null, a.start_time ?? null, a.duration_min ?? null, a.effort ?? null, a.notes ?? null, a.id, uid)
        .run();
      return res.meta.changes ? ok(await workoutDetail(a.id), "Workout updated.") : fail(`Workout ${a.id} not found`);
    },
  );

  server.registerTool(
    "delete_workout",
    { title: "Delete workout", description: "Delete a workout and all its sets.", inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true } },
    async (a) => {
      const [, res] = await db.batch([
        db.prepare("DELETE FROM workout_sets WHERE workout_id = ? AND user_id = ?").bind(a.id, uid),
        db.prepare("DELETE FROM workouts WHERE id = ? AND user_id = ?").bind(a.id, uid),
      ]);
      return res.meta.changes ? ok({ deleted: a.id }, "Workout deleted.") : fail(`Workout ${a.id} not found`);
    },
  );

  server.registerTool(
    "delete_set",
    { title: "Delete set", description: "Delete a single set (id from get_workout).", inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true } },
    async (a) => {
      const res = await db.prepare("DELETE FROM workout_sets WHERE id = ? AND user_id = ?").bind(a.id, uid).run();
      return res.meta.changes ? ok({ deleted: a.id }, "Set deleted.") : fail(`Set ${a.id} not found`);
    },
  );

  server.registerTool(
    "update_set",
    {
      title: "Update set",
      description: "Correct a single set (id from get_workout): reps, weight, rpe, distance, duration or warm-up flag.",
      inputSchema: z.object({
        id: z.string(),
        reps: z.number().int().min(0).max(1000).optional(),
        weight: z.number().min(0).max(2000).optional(),
        rpe: z.number().min(1).max(10).optional(),
        distance: z.number().positive().max(1000).optional(),
        duration_sec: z.number().int().positive().max(86_400).optional(),
        is_warmup: z.boolean().optional(),
      }),
    },
    async (a) => {
      const res = await db
        .prepare(
          `UPDATE workout_sets SET reps = COALESCE(?1, reps), weight_kg = CASE WHEN ?2 IS NULL THEN weight_kg WHEN ?2 = 0 THEN NULL ELSE ?2 END, rpe = COALESCE(?3, rpe),
             distance_km = COALESCE(?4, distance_km), duration_sec = COALESCE(?5, duration_sec), is_warmup = COALESCE(?6, is_warmup) WHERE id = ?7 AND user_id = ?8`,
        )
        .bind(
          a.reps ?? null,
          a.weight !== undefined ? toKg(a.weight, units()) : null,
          a.rpe ?? null,
          a.distance !== undefined ? toKm(a.distance, units()) : null,
          a.duration_sec ?? null,
          a.is_warmup === undefined ? null : a.is_warmup ? 1 : 0,
          a.id,
          uid,
        )
        .run();
      if (!res.meta.changes) return fail(`Set ${a.id} not found`);
      const s = await db.prepare("SELECT workout_id FROM workout_sets WHERE id = ?").bind(a.id).first<{ workout_id: string }>();
      return ok(await workoutDetail(s!.workout_id), "Set updated.");
    },
  );

  // ---------- exercise library ----------

  server.registerTool(
    "list_exercises",
    {
      title: "List / search exercises",
      description: "The user's exercise library with muscle group, equipment, type, how often each was done, when last, and the heaviest weight.",
      inputSchema: z.object({
        search: z.string().optional().describe("Substring match on the name"),
        muscle_group: z.string().optional(),
        type: z.enum(EXERCISE_TYPES).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const { results } = await db
        .prepare(
          `SELECT e.name, e.muscle_group, e.equipment, e.type, COUNT(DISTINCT s.workout_id) AS sessions, COUNT(s.id) AS sets, MAX(w.date) AS last_done, MAX(s.weight_kg) AS max_kg
           FROM exercises e LEFT JOIN workout_sets s ON s.exercise_id = e.id AND s.is_warmup = 0 LEFT JOIN workouts w ON w.id = s.workout_id
           WHERE e.user_id = ?1 AND (?2 IS NULL OR e.name LIKE '%' || ?2 || '%') AND (?3 IS NULL OR e.muscle_group = lower(?3)) AND (?4 IS NULL OR e.type = ?4)
           GROUP BY e.id ORDER BY sessions DESC, e.name`,
        )
        .bind(uid, a.search ?? null, a.muscle_group ?? null, a.type ?? null)
        .all<{ name: string; muscle_group: string | null; equipment: string | null; type: string; sessions: number; sets: number; last_done: string | null; max_kg: number | null }>();
      return ok(
        results.map((r) => ({
          name: r.name,
          muscle_group: r.muscle_group,
          equipment: r.equipment,
          type: r.type,
          sessions: r.sessions,
          working_sets: r.sets,
          last_done: r.last_done,
          heaviest: r.max_kg ? fmtWeight(r.max_kg, units()) : null,
        })),
      );
    },
  );

  server.registerTool(
    "add_exercise",
    {
      title: "Add exercise",
      description: "Add an exercise to the library (or update its muscle group / equipment / type). Logging also creates exercises automatically.",
      inputSchema: z.object({ name: exName, muscle_group: label.optional(), equipment: label.optional(), type: z.enum(EXERCISE_TYPES).optional() }),
    },
    async (a) => {
      await exerciseId(a.name, a);
      const ex = (await getExercise(a.name))!;
      return ok(ex, `${ex.name} (${ex.type}${ex.muscle_group ? `, ${ex.muscle_group}` : ""}) is in your library.`);
    },
  );

  server.registerTool(
    "update_exercise",
    {
      title: "Rename, merge or edit exercise",
      description: "Change an exercise's muscle group, equipment or type, or rename it. Renaming onto an existing name merges the two (history, routines and goals move over).",
      inputSchema: z.object({ exercise: exName, new_name: exName.optional(), muscle_group: label.optional(), equipment: label.optional(), type: z.enum(EXERCISE_TYPES).optional() }),
    },
    async (a) => {
      const src = await findExercise(a.exercise);
      if (typeof src === "string") return fail(src);
      await db
        .prepare("UPDATE exercises SET muscle_group = COALESCE(?, muscle_group), equipment = COALESCE(?, equipment), type = COALESCE(?, type) WHERE id = ?")
        .bind(norm(a.muscle_group), norm(a.equipment), a.type ?? null, src.id)
        .run();
      if (!a.new_name) return ok(await getExercise(src.name), `${src.name} updated.`);
      const dst = await getExercise(a.new_name);
      if (!dst || dst.id === src.id) {
        await db.prepare("UPDATE exercises SET name = ? WHERE id = ?").bind(a.new_name.trim(), src.id).run();
        return ok(await getExercise(a.new_name), `Renamed ${src.name} to ${a.new_name.trim()}.`);
      }
      await db.batch([
        db.prepare("UPDATE workout_sets SET exercise_id = ? WHERE exercise_id = ? AND user_id = ?").bind(dst.id, src.id, uid),
        db.prepare("UPDATE routine_exercises SET exercise_id = ? WHERE exercise_id = ? AND user_id = ?").bind(dst.id, src.id, uid),
        db
          .prepare("DELETE FROM goals WHERE exercise_id = ?1 AND user_id = ?2 AND (type || ':' || ?3) IN (SELECT goal_key FROM goals WHERE exercise_id = ?3 AND user_id = ?2)")
          .bind(src.id, uid, dst.id),
        db.prepare("UPDATE goals SET exercise_id = ?, goal_key = type || ':' || ? WHERE exercise_id = ? AND user_id = ?").bind(dst.id, dst.id, src.id, uid),
        db.prepare("DELETE FROM exercises WHERE id = ? AND user_id = ?").bind(src.id, uid),
      ]);
      return ok({ merged: src.name, into: dst.name }, `Merged ${src.name} into ${dst.name}.`);
    },
  );

  // ---------- records & progress ----------

  server.registerTool(
    "personal_records",
    {
      title: "Personal records",
      description:
        "All-time bests per exercise: heaviest weight, best estimated 1RM (Epley), best set volume, most reps (overall and per weight), longest / fastest cardio. Plus PRs set in the last 30 days.",
      inputSchema: z.object({ exercise: z.string().optional().describe("Only this exercise") }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      let exId: string | undefined;
      if (a.exercise) {
        const ex = await findExercise(a.exercise);
        if (typeof ex === "string") return fail(ex);
        exId = ex.id;
      }
      const sessions = summarize(await loadSets(db, uid, { exerciseId: exId }));
      const since = addDays(today(), -29);
      const recent = prEvents(sessions)
        .filter((e) => e.date >= since)
        .reverse();
      return ok({
        units: { weight: wu(), distance: distanceUnit(units()) },
        records: records(sessions, units()),
        recent_prs: recent.map((e) => ({ date: e.date, record: describePr(e, units()) })),
      });
    },
  );

  server.registerTool(
    "exercise_progress",
    {
      title: "Exercise progress",
      description: "How one exercise developed over a period: per session best set, estimated 1RM, top weight, volume (or distance/pace for cardio), plus first → last change and trend.",
      inputSchema: z.object({
        exercise: z.string().min(1),
        period: z.enum(PERIODS).default("last_90_days"),
        from: zDate.optional(),
        to: zDate.optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const ex = await findExercise(a.exercise);
      if (typeof ex === "string") return fail(ex);
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      return ok(await exerciseProgress(db, uid, ex, r.from, r.to, units(), r));
    },
  );

  // ---------- routines ----------

  const routineExercise = z.object({
    exercise: exName,
    sets: z.number().int().min(1).max(20).default(3),
    reps: z.number().int().min(1).max(1000).optional(),
    weight: z.number().min(0).max(2000).optional().describe(`Target load in ${wu()}`),
    distance: z.number().positive().max(1000).optional(),
    duration_sec: z.number().int().positive().max(86_400).optional(),
    muscle_group: label.optional(),
    type: z.enum(EXERCISE_TYPES).optional(),
    notes: z.string().max(200).optional(),
  });

  async function routineList() {
    const { results } = await db
      .prepare(
        `SELECT r.id, r.name, r.days, r.notes, (SELECT MAX(w.date) FROM workouts w WHERE w.routine_id = r.id) AS last_done
         FROM routines r WHERE r.user_id = ? ORDER BY r.name`,
      )
      .bind(uid)
      .all<{ id: string; name: string; days: string | null; notes: string | null; last_done: string | null }>();
    const { results: items } = await db
      .prepare(
        `SELECT re.routine_id, re.position, re.target_sets, re.target_reps, re.target_weight_kg, re.target_distance_km, re.target_duration_sec, re.notes, e.name AS exercise, e.id AS exercise_id
         FROM routine_exercises re JOIN exercises e ON e.id = re.exercise_id WHERE re.user_id = ? ORDER BY re.routine_id, re.position`,
      )
      .bind(uid)
      .all<{
        routine_id: string;
        position: number;
        target_sets: number;
        target_reps: number | null;
        target_weight_kg: number | null;
        target_distance_km: number | null;
        target_duration_sec: number | null;
        notes: string | null;
        exercise: string;
        exercise_id: string;
      }>();
    const todayDay = WEEKDAYS[weekday(today())];
    return results.map((r) => {
      const days = r.days ? r.days.split(",") : [];
      const exercises = items
        .filter((i) => i.routine_id === r.id)
        .map((i) => ({
          exercise: i.exercise,
          exercise_id: i.exercise_id,
          sets: i.target_sets,
          reps: i.target_reps,
          weight: i.target_weight_kg ? fromKg(i.target_weight_kg, units()) : null,
          distance: i.target_distance_km ? fromKm(i.target_distance_km, units()) : null,
          duration_sec: i.target_duration_sec,
          notes: i.notes,
          target: [
            `${i.target_sets} × ${i.target_reps ?? "-"}`,
            i.target_weight_kg ? `@ ${fmtWeight(i.target_weight_kg, units())}` : "",
            i.target_distance_km ? fmtDistance(i.target_distance_km, units()) : "",
            i.target_duration_sec ? fmtDuration(i.target_duration_sec) : "",
          ]
            .filter(Boolean)
            .join(" "),
        }));
      return { id: r.id, name: r.name, days, scheduled_today: days.includes(todayDay), last_done: r.last_done, notes: r.notes, exercises };
    });
  }

  server.registerTool(
    "create_routine",
    {
      title: "Create or replace routine",
      description: "Save a training plan (e.g. Push day on mon & thu) with target sets × reps × weight per exercise. Saving an existing name replaces it.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(80),
        days: z.array(z.enum(WEEKDAYS)).max(7).default([]).describe("Weekdays it is scheduled on"),
        notes: z.string().max(500).optional(),
        exercises: z.array(routineExercise).min(1).max(30),
      }),
    },
    async (a) => {
      const existing = await routineByName(a.name);
      const rid = existing?.id ?? id();
      const days = WEEKDAYS.filter((d) => a.days.includes(d)).join(",") || null;
      const stmts: D1PreparedStatement[] = [
        existing
          ? db.prepare("UPDATE routines SET name = ?, days = ?, notes = ? WHERE id = ?").bind(a.name, days, a.notes ?? existing.notes, rid)
          : db.prepare("INSERT INTO routines (id, user_id, name, days, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(rid, uid, a.name, days, a.notes ?? null, Date.now()),
        db.prepare("DELETE FROM routine_exercises WHERE routine_id = ? AND user_id = ?").bind(rid, uid),
      ];
      for (const [i, e] of a.exercises.entries()) {
        const eid = await exerciseId(e.exercise, e, e.distance !== undefined && e.reps === undefined ? "cardio" : undefined);
        stmts.push(
          db
            .prepare(
              `INSERT INTO routine_exercises (id, user_id, routine_id, exercise_id, position, target_sets, target_reps, target_weight_kg, target_distance_km, target_duration_sec, notes)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
            )
            .bind(
              id(),
              uid,
              rid,
              eid,
              i + 1,
              e.sets,
              e.reps ?? null,
              e.weight ? toKg(e.weight, units()) : null,
              e.distance !== undefined ? toKm(e.distance, units()) : null,
              e.duration_sec ?? null,
              e.notes ?? null,
            ),
        );
      }
      await db.batch(stmts);
      const r = (await routineList()).find((x) => x.id === rid)!;
      return ok(r, `${existing ? "Updated" : "Saved"} routine ${r.name}${r.days.length ? ` (${r.days.join(", ")})` : ""} with ${r.exercises.length} exercises.`);
    },
  );

  server.registerTool(
    "list_routines",
    { title: "List routines", description: "Saved routines with their schedule, target sets and when each was last done.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => ok(await routineList()),
  );

  server.registerTool(
    "delete_routine",
    { title: "Delete routine", description: "Delete a routine (logged workouts are kept).", inputSchema: z.object({ routine: z.string().min(1) }), annotations: { destructiveHint: true } },
    async (a) => {
      const r = await routineByName(a.routine);
      if (!r) return fail(`No routine named "${a.routine}"`);
      await db.batch([
        db.prepare("UPDATE workouts SET routine_id = NULL WHERE routine_id = ? AND user_id = ?").bind(r.id, uid),
        db.prepare("DELETE FROM routine_exercises WHERE routine_id = ? AND user_id = ?").bind(r.id, uid),
        db.prepare("DELETE FROM routines WHERE id = ? AND user_id = ?").bind(r.id, uid),
      ]);
      return ok({ deleted: r.name }, `Routine ${r.name} deleted.`);
    },
  );

  server.registerTool(
    "start_routine_workout",
    {
      title: "Start routine workout",
      description:
        "'Do my Push day': returns the routine's plan with what the user did last time for each exercise and a suggested load. " +
        "Without a routine name it picks today's scheduled routine. With log=true it logs the session exactly as planned (all target sets done) and reports PRs.",
      inputSchema: z.object({
        routine: z.string().trim().min(1).max(80).optional(),
        log: z.boolean().default(false).describe("true = the user completed it as planned; log it now"),
        ...workoutMeta,
      }),
    },
    async (a) => {
      const all = await routineList();
      let r = a.routine ? all.find((x) => x.name.toLowerCase() === a.routine!.toLowerCase()) : undefined;
      if (!a.routine) {
        const todays = all.filter((x) => x.scheduled_today);
        if (todays.length !== 1)
          return fail(
            todays.length
              ? `Several routines are scheduled today: ${todays.map((x) => x.name).join(", ")}. Which one?`
              : `No routine scheduled today${all.length ? `, pick one of: ${all.map((x) => x.name).join(", ")}` : " and no routines saved yet (create_routine)"}.`,
          );
        r = todays[0];
      }
      if (!r) return fail(`No routine named "${a.routine}", list_routines shows them.`);

      if (a.log) {
        const entries: Entry[] = r.exercises.map((e) => ({
          exercise: e.exercise,
          sets: [{ reps: e.reps ?? undefined, weight: e.weight ?? undefined, distance: e.distance ?? undefined, duration_sec: e.duration_sec ?? undefined, is_warmup: false, count: e.sets }].map((s) =>
            s.reps === undefined && s.distance === undefined && s.duration_sec === undefined ? { ...s, reps: 0 } : s,
          ),
        }));
        try {
          return await loggedResult(await createWorkout({ ...a, name: r.name }, r.id, entries), "Logged");
        } catch (err) {
          return fail((err as Error).message);
        }
      }

      const plan = [];
      for (const e of r.exercises) {
        const sessions = summarize(await loadSets(db, uid, { exerciseId: e.exercise_id })).filter((s) => s.sets > 0);
        const last = sessions.at(-1);
        let suggestion: string | null = null;
        if (last && e.reps && last.top_set && last.top_set.weight > 0) {
          const hit = (last.reps_by_weight.get(Math.round(last.top_weight * 1000) / 1000) ?? 0) >= e.reps;
          const step = units() === "imperial" ? 5 : 2.5;
          const lastW = fromKg(last.top_weight, units());
          suggestion = hit ? `Last time you hit ${e.reps}+ reps at ${lastW} ${wu()}, try ${round(lastW + step, 1)} ${wu()}.` : `Stay at ${lastW} ${wu()} and aim for ${e.reps} reps on every set.`;
        }
        plan.push({
          exercise: e.exercise,
          target: e.target,
          sets: e.sets,
          reps: e.reps,
          weight: e.weight,
          notes: e.notes,
          last_time: last ? { date: last.date, best_set: bestSetText(last), working_sets: last.sets } : null,
          suggestion,
        });
      }
      return ok(
        { routine: r.name, days: r.days, last_done: r.last_done, plan },
        `${r.name}: ${plan.length} exercises. When done, log it with log_workout (routine: "${r.name}"), or start_routine_workout with log: true if it went exactly as planned.`,
      );
    },
  );

  // ---------- body metrics ----------

  const metricShape = Object.fromEntries(
    METRICS.map((m) => [m, z.number().positive().max(m === "resting_hr" ? 250 : m === "body_fat_pct" ? 75 : 1500).optional().describe(`${METRIC_LABELS[m]} in ${metricUnit(m, units())}`)]),
  ) as Record<Metric, z.ZodOptional<z.ZodNumber>>;

  server.registerTool(
    "log_body_metric",
    {
      title: "Log body metrics",
      description: `Record body weight, body fat %, girths (waist, chest, arms, thighs, hips, neck) and/or resting heart rate for a day, in the user's units (${wu()}, ${metricUnit("waist", units())}). Re-logging the same day overwrites.`,
      inputSchema: z.object({ date: zDate.optional().describe("Defaults to today"), ...metricShape }),
    },
    async (a) => {
      const date = a.date ?? today();
      const given = METRICS.filter((m) => a[m] !== undefined);
      if (!given.length) return fail("Provide at least one metric (e.g. weight).");
      await db.batch(
        given.map((m) =>
          db
            .prepare(
              `INSERT INTO body_metrics (id, user_id, date, metric, value, created_at) VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (user_id, metric, date) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`,
            )
            .bind(id(), uid, date, m, metricToStored(m, a[m]!, units()), Date.now()),
        ),
      );
      const out = [];
      for (const m of given) {
        const prev = await db
          .prepare("SELECT date, value FROM body_metrics WHERE user_id = ? AND metric = ? AND date < ? ORDER BY date DESC LIMIT 1")
          .bind(uid, m, date)
          .first<{ date: string; value: number }>();
        const v = metricToStored(m, a[m]!, units());
        out.push({
          metric: m,
          value: a[m],
          unit: metricUnit(m, units()),
          previous: prev ? { date: prev.date, value: metricFromStored(m, prev.value, units()) } : null,
          change: prev ? round(metricFromStored(m, v, units()) - metricFromStored(m, prev.value, units()), 1) : null,
        });
      }
      return ok({ date, logged: out }, `Logged ${out.map((o) => `${METRIC_LABELS[o.metric].toLowerCase()} ${o.value}${o.unit === "%" ? "%" : ` ${o.unit}`}`).join(", ")} for ${date}.`);
    },
  );

  server.registerTool(
    "body_metrics_history",
    {
      title: "Body metrics history",
      description: "Body metric entries over a period with first → latest change, min and max per metric.",
      inputSchema: z.object({
        period: z.enum(PERIODS).default("last_90_days"),
        from: zDate.optional(),
        to: zDate.optional(),
        metric: z.enum(METRICS).optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      const hist = await metricHistory(db, uid, r.from, r.to, units(), a.metric);
      return ok({ period: r, metrics: hist });
    },
  );

  server.registerTool(
    "delete_body_metric",
    {
      title: "Delete body metric",
      description: "Remove one metric entry for a day.",
      inputSchema: z.object({ metric: z.enum(METRICS), date: zDate }),
      annotations: { destructiveHint: true },
    },
    async (a) => {
      const res = await db.prepare("DELETE FROM body_metrics WHERE user_id = ? AND metric = ? AND date = ?").bind(uid, a.metric, a.date).run();
      return res.meta.changes ? ok({ deleted: a }) : fail(`No ${a.metric} entry on ${a.date}`);
    },
  );

  // ---------- goals ----------

  server.registerTool(
    "set_goal",
    {
      title: "Set goal",
      description:
        "Create or update a goal. Types: workouts_per_week (count), minutes_per_week, total_volume_per_week (weight × reps), exercise_weight (lift X weight, needs exercise), " +
        `exercise_reps (X reps in one set, needs exercise), body_weight (target weight, up or down), body_fat_pct. Weights in ${wu()}.`,
      inputSchema: z.object({
        type: z.enum(GOAL_TYPES),
        target: z.number().positive().max(1e7),
        exercise: exName.optional().describe("Required for exercise_weight / exercise_reps"),
        deadline: zDate.optional(),
      }),
    },
    async (a) => {
      let exId: string | null = null;
      if (a.type === "exercise_weight" || a.type === "exercise_reps") {
        if (!a.exercise) return fail(`${a.type} goals need an exercise.`);
        const found = await findExercise(a.exercise);
        exId = typeof found === "string" ? await exerciseId(a.exercise) : found.id;
      }
      const target = a.type === "exercise_weight" || a.type === "body_weight" || a.type === "total_volume_per_week" ? toKg(a.target, units()) : a.target;
      let start: number | null = null;
      if (a.type === "body_weight" || a.type === "body_fat_pct") {
        const latest = await db
          .prepare("SELECT value FROM body_metrics WHERE user_id = ? AND metric = ? ORDER BY date DESC LIMIT 1")
          .bind(uid, a.type === "body_weight" ? "weight" : "body_fat_pct")
          .first<{ value: number }>();
        start = latest?.value ?? null;
      }
      const key = exId ? `${a.type}:${exId}` : a.type;
      await db
        .prepare(
          `INSERT INTO goals (id, user_id, type, goal_key, exercise_id, target, start_value, deadline, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
           ON CONFLICT (user_id, goal_key) DO UPDATE SET target = excluded.target, deadline = COALESCE(excluded.deadline, deadline), start_value = COALESCE(excluded.start_value, start_value)`,
        )
        .bind(id(), uid, a.type, key, exId, target, start, a.deadline ?? null, Date.now())
        .run();
      const g = (await goalProgress(db, uid, today(), units())).find((x) => x.key === key)!;
      return ok(g, `Goal set: ${g.description}.`);
    },
  );

  server.registerTool(
    "list_goals",
    { title: "List goals", description: "Goals with current value, progress % and whether they're achieved.", inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => ok(await goalProgress(db, uid, today(), units())),
  );

  server.registerTool(
    "delete_goal",
    { title: "Delete goal", description: "Delete a goal by id (from list_goals).", inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true } },
    async (a) => {
      const res = await db.prepare("DELETE FROM goals WHERE id = ? AND user_id = ?").bind(a.id, uid).run();
      return res.meta.changes ? ok({ deleted: a.id }, "Goal deleted.") : fail(`Goal ${a.id} not found`);
    },
  );

  // ---------- follow-up & report ----------

  server.registerTool(
    "follow_up",
    {
      title: "Workout follow-up",
      description:
        "Check-in: streak (weeks meeting the weekly goal, consecutive days), workouts this week vs goal, days since last workout, muscle groups not trained for 7+ days, " +
        "today's scheduled routines, recent PRs (14 days), goal progress, body-weight trend, and nudges.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => ok(await followUp(db, uid, today(), units(), await routineList())),
  );

  server.registerTool(
    "generate_report",
    {
      title: "Generate workout report",
      description:
        "Well-organized training report for a period: KPIs, highlights vs. previous period, volume by muscle group, sessions log, top exercises, PRs, exercise progress, body metrics, goals and weekly consistency. Returns Markdown plus a printable link.",
      inputSchema: z.object(zPeriodInput),
      annotations: { readOnlyHint: true },
    },
    async (a) => reportResult(ctx, await buildReport(ctx, resolvePeriod(user.timezone, a.period, a.from, a.to))),
  );

  return server;
}

// ---------- queries shared with the report ----------

export function fmtSummary(w: WorkoutSummaryRow, u: Units) {
  return {
    id: w.id,
    date: w.date,
    name: w.name,
    start_time: w.start_time,
    duration_min: w.duration_min,
    effort: w.effort,
    routine: w.routine,
    exercises: w.exercises,
    working_sets: w.sets,
    volume: fromKg(w.volume_kg, u, 0),
    muscle_groups: w.muscle_groups ? w.muscle_groups.split(",").sort() : [],
    notes: w.notes,
  };
}

export async function workoutSummaries(db: D1Database, uid: string, from: string, to: string, exerciseId: string | null = null, limit = 1000) {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.name, w.date, w.start_time, w.duration_min, w.effort, w.notes, r.name AS routine,
         (SELECT COUNT(DISTINCT s.exercise_id) FROM workout_sets s WHERE s.workout_id = w.id) AS exercises,
         (SELECT COUNT(*) FROM workout_sets s WHERE s.workout_id = w.id AND s.is_warmup = 0) AS sets,
         (SELECT COALESCE(SUM(s.weight_kg * s.reps), 0) FROM workout_sets s WHERE s.workout_id = w.id AND s.is_warmup = 0) AS volume_kg,
         (SELECT group_concat(DISTINCT e.muscle_group) FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id WHERE s.workout_id = w.id) AS muscle_groups
       FROM workouts w LEFT JOIN routines r ON r.id = w.routine_id
       WHERE w.user_id = ?1 AND w.date BETWEEN ?2 AND ?3
         AND (?4 IS NULL OR EXISTS (SELECT 1 FROM workout_sets s WHERE s.workout_id = w.id AND s.exercise_id = ?4))
       ORDER BY w.date DESC, COALESCE(w.start_time, '') DESC, w.created_at DESC LIMIT ?5`,
    )
    .bind(uid, from, to, exerciseId, limit)
    .all<WorkoutSummaryRow>();
  return results;
}

export async function exerciseProgress(db: D1Database, uid: string, ex: ExerciseRow, from: string, to: string, u: Units, period?: unknown) {
  const sessions = summarize(await loadSets(db, uid, { exerciseId: ex.id, from, to })).filter((s) => s.sets > 0);
  const metrics = new Set(sessions.map((s) => headline(s).metric));
  const metric = (["e1rm", "distance", "reps", "duration"] as const).find((m) => metrics.has(m)) ?? (ex.type === "cardio" ? "distance" : "e1rm");
  const valueOf = (s: ExerciseSession) => (metric === "e1rm" ? s.best_e1rm : metric === "distance" ? s.max_distance : metric === "reps" ? s.max_reps : s.max_duration);
  const show = (v: number) => (metric === "e1rm" ? fromKg(v, u) : metric === "distance" ? fromKm(v, u) : v);
  const rows = sessions.map((s) => ({
    date: s.date,
    workout: s.workout,
    best_set: s.e1rm_set ? `${fmtWeight(s.e1rm_set.weight, u)} × ${s.e1rm_set.reps}` : s.max_distance ? fmtDistance(s.max_distance, u) : s.max_reps ? `${s.max_reps} reps` : s.max_duration ? fmtDuration(s.max_duration) : null,
    e1rm: s.best_e1rm ? fromKg(s.best_e1rm, u) : null,
    top_weight: s.top_weight ? fromKg(s.top_weight, u) : null,
    working_sets: s.sets,
    reps: s.reps,
    volume: fromKg(s.volume_kg, u, 0),
    ...(s.distance_km ? { distance: fromKm(s.distance_km, u) } : {}),
    ...(s.duration_sec ? { duration: fmtDuration(s.duration_sec) } : {}),
    ...(s.best_pace ? { pace: fmtPace(s.best_pace, u) } : {}),
    avg_rpe: s.avg_rpe,
  }));
  const vals = sessions.map(valueOf).filter((v) => v > 0);
  const first = vals[0] ?? 0;
  const last = vals.at(-1) ?? 0;
  const best = vals.length ? Math.max(...vals) : 0;
  const unit = metric === "e1rm" ? weightUnit(u) : metric === "distance" ? distanceUnit(u) : metric === "reps" ? "reps" : "sec";
  const trend = trendOf(first, last, vals.length);
  return {
    exercise: ex.name,
    muscle_group: ex.muscle_group,
    type: ex.type,
    ...(period ? { period } : {}),
    metric: metric === "e1rm" ? "estimated 1RM (Epley)" : metric,
    unit,
    sessions: rows,
    summary: {
      sessions: rows.length,
      first: vals.length ? show(first) : null,
      last: vals.length ? show(last) : null,
      best: vals.length ? show(best) : null,
      change: vals.length ? round(Number(show(last)) - Number(show(first)), 1) : null,
      change_percent: pctChange(first, last),
      total_volume: fromKg(sessions.reduce((n, s) => n + s.volume_kg, 0), u, 0),
      trend,
      text: vals.length >= 2 ? `${ex.name} ${metric === "e1rm" ? "e1RM" : metric}: ${show(first)} → ${show(last)} ${unit} (${trend}).` : vals.length ? `Only one session of ${ex.name} in this period.` : `No ${ex.name} sessions in this period.`,
    },
  };
}

export async function metricHistory(db: D1Database, uid: string, from: string, to: string, u: Units, only?: Metric) {
  const { results } = await db
    .prepare("SELECT date, metric, value FROM body_metrics WHERE user_id = ?1 AND date BETWEEN ?2 AND ?3 AND (?4 IS NULL OR metric = ?4) ORDER BY date")
    .bind(uid, from, to, only ?? null)
    .all<{ date: string; metric: Metric; value: number }>();
  return METRICS.filter((m) => results.some((r) => r.metric === m)).map((m) => {
    const list = results.filter((r) => r.metric === m);
    const vals = list.map((r) => metricFromStored(m, r.value, u));
    const first = list[0];
    const last = list.at(-1)!;
    return {
      metric: m,
      label: METRIC_LABELS[m],
      unit: metricUnit(m, u),
      entries: list.map((r, i) => ({ date: r.date, value: vals[i] })),
      first: { date: first.date, value: vals[0] },
      latest: { date: last.date, value: vals.at(-1)! },
      change: round(vals.at(-1)! - vals[0], 1),
      min: Math.min(...vals),
      max: Math.max(...vals),
      first_display: fmtMetric(m, first.value, u),
      latest_display: fmtMetric(m, last.value, u),
    };
  });
}

const GOAL_LABELS: Record<GoalType, string> = {
  workouts_per_week: "Workouts per week",
  minutes_per_week: "Minutes per week",
  total_volume_per_week: "Weekly volume",
  exercise_weight: "Lift",
  exercise_reps: "Reps in one set",
  body_weight: "Body weight",
  body_fat_pct: "Body fat",
};

export async function goalProgress(db: D1Database, uid: string, today: string, u: Units) {
  const { results } = await db
    .prepare(
      `SELECT g.id, g.type, g.goal_key, g.exercise_id, g.target, g.start_value, g.deadline, e.name AS exercise
       FROM goals g LEFT JOIN exercises e ON e.id = g.exercise_id WHERE g.user_id = ? ORDER BY g.created_at`,
    )
    .bind(uid)
    .all<{ id: string; type: GoalType; goal_key: string; exercise_id: string | null; target: number; start_value: number | null; deadline: string | null; exercise: string | null }>();
  if (!results.length) return [];
  const weekStart = startOfWeek(today);
  const week = (await db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(duration_min), 0) AS minutes,
              (SELECT COALESCE(SUM(s.weight_kg * s.reps), 0) FROM workout_sets s JOIN workouts w2 ON w2.id = s.workout_id
               WHERE s.user_id = ?1 AND s.is_warmup = 0 AND w2.date BETWEEN ?2 AND ?3) AS volume
       FROM workouts WHERE user_id = ?1 AND date BETWEEN ?2 AND ?3`,
    )
    .bind(uid, weekStart, today)
    .first<{ n: number; minutes: number; volume: number }>())!;
  const latest = async (metric: Metric) =>
    (await db.prepare("SELECT value FROM body_metrics WHERE user_id = ? AND metric = ? ORDER BY date DESC LIMIT 1").bind(uid, metric).first<{ value: number }>())?.value ?? null;

  const out = [];
  for (const g of results) {
    let current: number | null = null;
    switch (g.type) {
      case "workouts_per_week":
        current = week.n;
        break;
      case "minutes_per_week":
        current = week.minutes;
        break;
      case "total_volume_per_week":
        current = week.volume;
        break;
      case "exercise_weight":
      case "exercise_reps": {
        const r = await db
          .prepare(`SELECT MAX(${g.type === "exercise_weight" ? "weight_kg" : "reps"}) AS v FROM workout_sets WHERE user_id = ? AND exercise_id = ? AND is_warmup = 0 AND reps > 0`)
          .bind(uid, g.exercise_id)
          .first<{ v: number | null }>();
        current = r?.v ?? 0;
        break;
      }
      case "body_weight":
        current = await latest("weight");
        break;
      case "body_fat_pct":
        current = await latest("body_fat_pct");
        break;
    }
    let percent: number;
    let achieved: boolean;
    let direction: "increase" | "decrease" = "increase";
    if (g.type === "body_weight" || g.type === "body_fat_pct") {
      const start = g.start_value ?? current;
      direction = start !== null && g.target < start ? "decrease" : "increase";
      if (current === null || start === null) {
        percent = 0;
        achieved = false;
      } else {
        achieved = direction === "decrease" ? current <= g.target : current >= g.target;
        percent = achieved ? 100 : start === g.target ? 0 : Math.max(0, Math.min(100, Math.round(((start - current) / (start - g.target)) * 100)));
      }
    } else {
      achieved = (current ?? 0) >= g.target;
      percent = Math.min(100, Math.round(((current ?? 0) / g.target) * 100));
    }
    const kind = g.type === "body_fat_pct" ? "body_fat_pct" : g.type === "body_weight" ? "weight" : null;
    const disp = (v: number | null) =>
      v === null
        ? null
        : g.type === "exercise_weight" || g.type === "body_weight" || g.type === "total_volume_per_week"
          ? fromKg(v, u, g.type === "total_volume_per_week" ? 0 : 1)
          : round(v, 1);
    const unit =
      g.type === "workouts_per_week" ? "workouts" : g.type === "minutes_per_week" ? "min" : g.type === "exercise_reps" ? "reps" : kind === "body_fat_pct" ? "%" : weightUnit(u);
    const withUnit = (v: number | null) => `${v}${unit === "%" ? "%" : ` ${unit}`}`;
    const name = g.exercise
      ? `${g.exercise} ${withUnit(disp(g.target))}`
      : g.type.endsWith("_per_week")
        ? `${withUnit(disp(g.target))}${g.type === "total_volume_per_week" ? " volume" : ""} per week`
        : `${GOAL_LABELS[g.type]} ${withUnit(disp(g.target))}`;
    const period = g.type.endsWith("_per_week") ? " this week" : "";
    out.push({
      id: g.id,
      key: g.goal_key,
      type: g.type,
      label: GOAL_LABELS[g.type],
      exercise: g.exercise,
      target: disp(g.target),
      current: disp(current),
      start: g.start_value !== null ? disp(g.start_value) : null,
      unit,
      direction,
      percent,
      achieved,
      deadline: g.deadline,
      days_left: g.deadline ? daysBetween(today, g.deadline) : null,
      description: `${name}: ${current === null ? "no data yet" : `${withUnit(disp(current))}${period}`} (${percent}%)${achieved ? " (achieved)" : ""}`,
    });
  }
  return out;
}

export async function followUp(db: D1Database, uid: string, today: string, u: Units, routines: { name: string; scheduled_today: boolean; last_done: string | null; id: string }[]) {
  const goals = await goalProgress(db, uid, today, u);
  const weeklyGoal = goals.find((g) => g.type === "workouts_per_week");
  const streak = await streaks(db, uid, today, weeklyGoal ? Number(weeklyGoal.target) : 1);
  const last = await db
    .prepare("SELECT id, name, date FROM workouts WHERE user_id = ? AND date <= ? ORDER BY date DESC, created_at DESC LIMIT 1")
    .bind(uid, today)
    .first<{ id: string; name: string; date: string }>();
  const weekStart = startOfWeek(today);
  const week = await workoutSummaries(db, uid, weekStart, today);

  // Muscle groups trained before, but not in the last 7 days.
  const { results: groups } = await db
    .prepare(
      `SELECT e.muscle_group AS grp, MAX(w.date) AS last FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id JOIN workouts w ON w.id = s.workout_id
       WHERE s.user_id = ? AND s.is_warmup = 0 AND e.muscle_group IS NOT NULL AND w.date <= ? GROUP BY e.muscle_group`,
    )
    .bind(uid, today)
    .all<{ grp: string; last: string }>();
  const neglected = groups
    .map((g) => ({ muscle_group: g.grp, last_trained: g.last, days_ago: daysBetween(g.last, today) }))
    .filter((g) => g.days_ago >= 7)
    .sort((a, b) => b.days_ago - a.days_ago);

  const sessions = summarize(await loadSets(db, uid, { to: today }));
  const since = addDays(today, -13);
  const recentPrs = prEvents(sessions)
    .filter((e) => e.date >= since)
    .reverse();

  const scheduled = routines.filter((r) => r.scheduled_today).map((r) => ({ routine: r.name, done_today: r.last_done === today }));

  const weights = await metricHistory(db, uid, addDays(today, -89), today, u, "weight");
  const latestWeight = await db
    .prepare("SELECT date, value FROM body_metrics WHERE user_id = ? AND metric = 'weight' ORDER BY date DESC LIMIT 1")
    .bind(uid)
    .first<{ date: string; value: number }>();
  const w30 = weights[0]?.entries.filter((e) => e.date >= addDays(today, -29)) ?? [];
  const bodyWeight = latestWeight
    ? {
        latest: fromKg(latestWeight.value, u),
        unit: weightUnit(u),
        date: latestWeight.date,
        change_30_days: w30.length >= 2 ? round(w30.at(-1)!.value - w30[0].value, 1) : null,
        trend: w30.length >= 2 ? (w30.at(-1)!.value < w30[0].value ? "down" : w30.at(-1)!.value > w30[0].value ? "up" : "flat") : "not enough data",
      }
    : null;

  const daysSince = last ? daysBetween(last.date, today) : null;
  const nudges: string[] = [];
  if (!last) nudges.push("No workouts logged yet, tell me what you trained and I'll log it.");
  else if (daysSince! >= 3) nudges.push(`It's been ${daysSince} days since your last workout (${last.name} on ${last.date}).`);
  for (const s of scheduled) if (!s.done_today) nudges.push(`Today is ${s.routine}, say "start ${s.routine}" to see the plan.`);
  if (weeklyGoal) {
    const left = Number(weeklyGoal.target) - week.length;
    nudges.push(left > 0 ? `${week.length} of ${weeklyGoal.target} workouts done this week, ${left} to go.` : `Weekly goal reached: ${week.length} workouts this week.`);
  } else nudges.push("No weekly workout goal yet, try set_goal with workouts_per_week to track a streak.");
  if (streak.weeks >= 2) nudges.push(`You're on a ${streak.weeks}-week streak, keep it going!`);
  for (const g of neglected.slice(0, 3)) nudges.push(`You haven't trained ${g.muscle_group} in ${g.days_ago} days.`);
  if (recentPrs.length) nudges.push(`${recentPrs.length} new PR${recentPrs.length > 1 ? "s" : ""} in the last 14 days, latest: ${describePr(recentPrs[0], u)}.`);
  for (const g of goals) if (!g.achieved && g.percent >= 90) nudges.push(`Almost there: ${g.description}.`);
  if (latestWeight && daysBetween(latestWeight.date, today) >= 14) nudges.push(`Last weigh-in was ${daysBetween(latestWeight.date, today)} days ago, log your weight to keep the trend accurate.`);

  return {
    today,
    streak,
    this_week: {
      from: weekStart,
      workouts: week.length,
      goal: weeklyGoal ? Number(weeklyGoal.target) : null,
      minutes: week.reduce((n, w) => n + (w.duration_min ?? 0), 0),
      volume: fromKg(week.reduce((n, w) => n + w.volume_kg, 0), u, 0),
      unit: weightUnit(u),
    },
    last_workout: last ? { ...last, days_ago: daysSince } : null,
    days_since_last_workout: daysSince,
    neglected_muscle_groups: neglected,
    scheduled_today: scheduled,
    recent_pr_count: recentPrs.length,
    recent_prs: recentPrs.slice(0, 10).map((e) => ({ date: e.date, record: describePr(e, u) })),
    goals,
    body_weight: bodyWeight,
    nudges,
  };
}


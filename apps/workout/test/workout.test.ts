import { env } from "cloudflare:test";
import { addDays, localDate, purgeDeletedUsers, startOfWeek, WEEKDAYS, weekday, type Units } from "@quemo/core";
import { connect, fakeAuth, TEST_USER, testContext, type Caller } from "@quemo/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer, type Env } from "../src/server";
import { e1rm, fmtDuration, fmtPace, fromKg, prEvents, summarize, toKg, type SetRow } from "../src/stats";

const USER_TABLES = ["workout_sets", "workouts", "routine_exercises", "routines", "body_metrics", "goals", "exercises"];

let n = 0;
async function newUser(units: Units = "metric"): Promise<{ mcp: Caller; userId: string }> {
  const userId = `workout-user-${++n}-${crypto.randomUUID()}`;
  const ctx = testContext<Env>({ DB: env.DB, PUBLIC_URL: "http://localhost:8789" }, { ...TEST_USER, id: userId, units });
  return { mcp: await connect(buildServer(ctx)), userId };
}

const today = () => localDate("Europe/Berlin");
const daysAgo = (d: number) => addDays(today(), -d);
const bench = (sets: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ exercise: "Bench Press", muscle_group: "chest", sets, ...extra });

describe("logging workouts", () => {
  let mcp: Caller;
  beforeEach(async () => ({ mcp } = await newUser()));

  it("logs a full session in one call and expands repeated sets", async () => {
    const res = await mcp.call("log_workout", {
      name: "Push day",
      start_time: "18:30",
      duration_min: 60,
      effort: 8,
      notes: "felt strong",
      exercises: [
        bench([
          { reps: 10, weight: 40, is_warmup: true },
          { reps: 8, weight: 70, count: 4, rpe: 8 },
        ]),
        { exercise: "Overhead Press", sets: [{ reps: 10, weight: 40, count: 3 }] },
        { exercise: "Push-up", sets: [{ reps: 20 }] },
      ],
    });
    const w = res.workout;
    expect(w).toMatchObject({ name: "Push day", date: today(), start_time: "18:30", duration_min: 60, effort: 8, notes: "felt strong" });
    // warm-up excluded from working sets and volume
    expect(w.totals).toMatchObject({ exercises: 3, working_sets: 8, volume: 4 * 8 * 70 + 3 * 10 * 40 });
    expect(w.exercises.map((e: any) => e.exercise)).toEqual(["Bench Press", "Overhead Press", "Push-up"]);
    expect(w.exercises[0].sets).toHaveLength(5);
    expect(w.exercises[0].sets[0]).toMatchObject({ set: 1, reps: 10, weight: 40, is_warmup: true });
    expect(w.exercises[0].sets[4]).toMatchObject({ set: 5, reps: 8, weight: 70, rpe: 8, display: "70 kg × 8" });
    expect(w.exercises[0].e1rm).toBe(88.7);
    expect(res.new_prs).toEqual([]);
    expect(res.first_time_exercises.sort()).toEqual(["Bench Press", "Overhead Press", "Push-up"]);

    // exercises auto-created; muscle group inferred where the AI didn't pass one
    const lib = await mcp.call("list_exercises");
    expect(lib.find((e: any) => e.name === "Overhead Press")).toMatchObject({ muscle_group: "shoulders", type: "strength", sessions: 1, working_sets: 3 });
    expect(lib.find((e: any) => e.name === "Push-up")).toMatchObject({ muscle_group: "chest", equipment: "bodyweight" });
    expect(lib.find((e: any) => e.name === "Bench Press")).toMatchObject({ heaviest: "70 kg", equipment: "barbell" });
  });

  it("matches exercise names case-insensitively and searches the library", async () => {
    await mcp.call("log_workout", { exercises: [{ exercise: "Barbell Squat", sets: [{ reps: 5, weight: 100 }] }] });
    await mcp.call("log_workout", { exercises: [{ exercise: "barbell squat", sets: [{ reps: 5, weight: 105 }] }] });
    const lib = await mcp.call("list_exercises");
    expect(lib).toHaveLength(1);
    expect(lib[0]).toMatchObject({ name: "Barbell Squat", sessions: 2, muscle_group: "legs" });
    expect(await mcp.call("list_exercises", { search: "squat" })).toHaveLength(1);
    expect(await mcp.call("list_exercises", { muscle_group: "chest" })).toEqual([]);
  });

  it("logs cardio with distance and duration", async () => {
    const res = await mcp.call("log_workout", { name: "Morning run", duration_min: 25, exercises: [{ exercise: "Running", sets: [{ distance: 5, duration_sec: 1500 }] }] });
    expect(res.workout.exercises[0]).toMatchObject({ exercise: "Running", type: "cardio", muscle_group: "cardio", best_set: "5 km" });
    expect(res.workout.totals.distance).toBe(5);
  });

  it("adds sets, updates, deletes sets and workouts", async () => {
    const { workout } = await mcp.call("log_workout", { name: "Pull", exercises: [{ exercise: "Pull-up", sets: [{ reps: 8, count: 2 }] }] });
    const more = await mcp.call("add_sets", {
      workout_id: workout.id,
      exercises: [
        { exercise: "pull-up", sets: [{ reps: 6 }] },
        { exercise: "Barbell Row", sets: [{ reps: 10, weight: 60, count: 3 }] },
      ],
    });
    const pullups = more.workout.exercises[0];
    expect(pullups.exercise).toBe("Pull-up");
    expect(pullups.sets.map((s: any) => s.set)).toEqual([1, 2, 3]);
    expect(more.workout.exercises[1].exercise).toBe("Barbell Row");

    const upd = await mcp.call("update_workout", { id: workout.id, name: "Pull day", effort: 7, duration_min: 45, date: daysAgo(1) });
    expect(upd).toMatchObject({ name: "Pull day", effort: 7, duration_min: 45, date: daysAgo(1) });

    const setId = more.workout.exercises[1].sets[0].id;
    const fixed = await mcp.call("update_set", { id: setId, weight: 65, reps: 9 });
    expect(fixed.exercises[1].sets[0]).toMatchObject({ weight: 65, reps: 9 });

    await mcp.call("delete_set", { id: setId });
    const detail = await mcp.call("get_workout", { id: workout.id });
    expect(detail.exercises[1].sets).toHaveLength(2);
    expect(await mcp.callError("delete_set", { id: setId })).toMatch(/not found/);

    const listed = await mcp.call("list_workouts", { period: "last_7_days" });
    expect(listed.count).toBe(1);
    expect(listed.workouts[0]).toMatchObject({ name: "Pull day", exercises: 2, working_sets: 5, volume: 2 * 10 * 60 });
    expect(listed.workouts[0].muscle_groups).toEqual(["back"]);
    expect((await mcp.call("list_workouts", { period: "last_7_days", exercise: "row" })).count).toBe(1);

    await mcp.call("delete_workout", { id: workout.id });
    expect((await mcp.call("list_workouts", { period: "last_7_days" })).count).toBe(0);
    expect(await mcp.callError("get_workout", { id: workout.id })).toMatch(/not found/);
    const orphanSets = await env.DB.prepare("SELECT COUNT(*) AS n FROM workout_sets WHERE workout_id = ?").bind(workout.id).first("n");
    expect(orphanSets).toBe(0);
  });

  it("filters workouts by period", async () => {
    await mcp.call("log_workout", { name: "Old", date: daysAgo(40), duration_min: 30 });
    await mcp.call("log_workout", { name: "Recent", date: daysAgo(2), duration_min: 30 });
    expect((await mcp.call("list_workouts", { period: "last_30_days" })).workouts.map((w: any) => w.name)).toEqual(["Recent"]);
    expect((await mcp.call("list_workouts", { period: "custom", from: daysAgo(45), to: daysAgo(35) })).workouts.map((w: any) => w.name)).toEqual(["Old"]);
  });

  it("rejects invalid input", async () => {
    await expect(mcp.call("log_workout", { effort: 11, duration_min: 30 })).rejects.toThrow();
    await expect(mcp.call("log_workout", { date: "25/10/2026", duration_min: 30 })).rejects.toThrow();
    await expect(mcp.call("log_workout", { start_time: "25:00", duration_min: 30 })).rejects.toThrow();
    await expect(mcp.call("log_workout", { exercises: [{ exercise: "Bench", sets: [{ weight: 50 }] }] })).rejects.toThrow(/reps, distance or duration_sec/);
    await expect(mcp.call("log_workout", { exercises: [{ exercise: "Bench", sets: [{ reps: -1 }] }] })).rejects.toThrow();
    await expect(mcp.call("log_workout", { exercises: [{ exercise: "", sets: [{ reps: 5 }] }] })).rejects.toThrow();
    expect(await mcp.callError("log_workout", {})).toMatch(/at least one exercise/);
    expect(await mcp.callError("log_workout", { date: addDays(today(), 2), duration_min: 30 })).toMatch(/future/);
    expect(await mcp.callError("log_workout", { routine: "Nope", duration_min: 30 })).toMatch(/No routine/);
    expect(await mcp.callError("add_sets", { workout_id: "missing", exercises: [{ exercise: "X", sets: [{ reps: 1 }] }] })).toMatch(/not found/);
    expect((await mcp.call("list_workouts", { period: "this_year" })).count).toBe(0);
  });
});

describe("units", () => {
  it("accepts and displays imperial units while storing kg / km", async () => {
    const { mcp, userId } = await newUser("imperial");
    const res = await mcp.call("log_workout", {
      exercises: [
        { exercise: "Deadlift", sets: [{ reps: 5, weight: 225, count: 2 }] },
        { exercise: "Running", sets: [{ distance: 3.1, duration_sec: 1500 }] },
      ],
    });
    expect(res.workout.units).toEqual({ weight: "lb", distance: "mi" });
    expect(res.workout.exercises[0].sets[0]).toMatchObject({ reps: 5, weight: 225, display: "225 lb × 5" });
    expect(res.workout.exercises[0].volume).toBe(2250);
    expect(res.workout.exercises[1].sets[0].distance).toBe(3.1);

    const stored = await env.DB.prepare("SELECT weight_kg FROM workout_sets WHERE user_id = ? AND weight_kg IS NOT NULL LIMIT 1").bind(userId).first<number>("weight_kg");
    expect(stored).toBeCloseTo(102.058, 2);
    const km = await env.DB.prepare("SELECT distance_km FROM workout_sets WHERE user_id = ? AND distance_km IS NOT NULL").bind(userId).first<number>("distance_km");
    expect(km).toBeCloseTo(4.989, 2);

    await mcp.call("log_body_metric", { weight: 180, waist: 34 });
    const hist = await mcp.call("body_metrics_history");
    expect(hist.metrics.find((m: any) => m.metric === "weight")).toMatchObject({ unit: "lb", latest: { value: 180 } });
    expect(hist.metrics.find((m: any) => m.metric === "waist")).toMatchObject({ unit: "in", latest: { value: 34 } });
    const kg = await env.DB.prepare("SELECT value FROM body_metrics WHERE user_id = ? AND metric = 'weight'").bind(userId).first<number>("value");
    expect(kg).toBeCloseTo(81.65, 1);

    const goal = await mcp.call("set_goal", { type: "exercise_weight", exercise: "Deadlift", target: 315 });
    expect(goal).toMatchObject({ target: 315, current: 225, unit: "lb", percent: 71 });

    const pr = await mcp.call("personal_records", { exercise: "deadlift" });
    expect(pr.records[0].heaviest_weight).toMatchObject({ weight: 225, reps: 5 });
    expect(pr.units).toEqual({ weight: "lb", distance: "mi" });
  });

  it("converts helpers both ways", () => {
    expect(fromKg(toKg(225, "imperial"), "imperial")).toBe(225);
    expect(toKg(100, "metric")).toBe(100);
    expect(fmtDuration(1500)).toBe("25:00");
    expect(fmtDuration(3725)).toBe("1:02:05");
    expect(fmtPace(300, "metric")).toBe("5:00 /km");
    expect(fmtPace(300, "imperial")).toBe("8:03 /mi");
  });
});

describe("personal records", () => {
  it("computes the Epley estimated 1RM", () => {
    expect(e1rm(100, 5)).toBeCloseTo(116.667, 3);
    expect(e1rm(80, 10)).toBeCloseTo(106.667, 3);
    expect(e1rm(100, 30)).toBe(200);
    expect(e1rm(140, 1)).toBe(140);
    expect(e1rm(0, 10)).toBe(0);
    expect(e1rm(100, 0)).toBe(0);
  });

  it("detects PRs chronologically and ignores warm-ups and first sessions", () => {
    const row = (workout: string, date: string, reps: number, weight: number, warm = 0): SetRow => ({
      id: crypto.randomUUID(),
      workout_id: workout,
      workout,
      exercise_id: "bench",
      exercise: "Bench",
      muscle_group: "chest",
      type: "strength",
      date,
      position: 1,
      set_number: 1,
      reps,
      weight_kg: weight,
      rpe: null,
      distance_km: null,
      duration_sec: null,
      is_warmup: warm,
    });
    const events = prEvents(summarize([row("a", "2026-01-01", 5, 100), row("b", "2026-01-02", 1, 200, 1), row("b", "2026-01-02", 5, 100), row("c", "2026-01-03", 6, 100)]));
    expect(events.filter((e) => e.workout_id === "a")).toEqual([]);
    expect(events.filter((e) => e.workout_id === "b")).toEqual([]);
    expect(events.map((e) => e.kind).sort()).toEqual(["best_e1rm", "best_set_volume", "most_reps_at_weight"]);
  });

  it("announces new PRs when logging and lists all-time records", async () => {
    const { mcp } = await newUser();
    const first = await mcp.call("log_workout", { date: daysAgo(3), exercises: [bench([{ reps: 5, weight: 100, count: 3 }])] });
    expect(first.new_prs).toEqual([]);
    expect(first.first_time_exercises).toEqual(["Bench Press"]);

    // heavier, but fewer reps: weight PR only (e1RM 115.5 < 116.7)
    const second = await mcp.call("log_workout", { date: daysAgo(2), exercises: [bench([{ reps: 3, weight: 105 }, { reps: 12, weight: 140, is_warmup: true }])] });
    expect(second.new_prs).toEqual(["Bench Press: heaviest weight 105 kg (3 reps), previous 100 kg"]);

    const third = await mcp.call("log_workout", { date: daysAgo(1), exercises: [bench([{ reps: 8, weight: 100 }])] });
    expect(third.new_prs).toHaveLength(3);
    expect(third.new_prs.join("\n")).toMatch(/best estimated 1RM 126\.7 kg \(8 reps\), previous 116\.7 kg/);
    expect(third.new_prs.join("\n")).toMatch(/most reps at 100 kg 8 reps, previous 5 reps/);
    expect(third.new_prs.join("\n")).toMatch(/best set volume 800 kg, previous 500 kg/);
    expect(await mcp.text("log_workout", { exercises: [bench([{ reps: 1, weight: 110 }])] })).toMatch(/New PR! Bench Press: heaviest weight 110 kg/);

    const pr = await mcp.call("personal_records");
    const b = pr.records.find((r: any) => r.exercise === "Bench Press");
    expect(b.heaviest_weight).toMatchObject({ weight: 110, reps: 1, date: today() });
    expect(b.best_e1rm).toMatchObject({ e1rm: 126.7, set: { weight: 100, reps: 8 }, date: daysAgo(1) });
    expect(b.best_set_volume).toMatchObject({ volume: 800 });
    expect(b.most_reps).toMatchObject({ reps: 8, weight: 100 });
    expect(b.most_reps_by_weight).toEqual([
      { weight: 110, reps: 1, date: today() },
      { weight: 105, reps: 3, date: daysAgo(2) },
      { weight: 100, reps: 8, date: daysAgo(1) },
    ]);
    expect(pr.recent_prs.length).toBe(5);
    expect(await mcp.callError("personal_records", { exercise: "Curl" })).toMatch(/No exercise named/);
  });

  it("tracks cardio records: longest distance and fastest pace", async () => {
    const { mcp } = await newUser();
    await mcp.call("log_workout", { date: daysAgo(5), exercises: [{ exercise: "Running", sets: [{ distance: 5, duration_sec: 1500 }] }] });
    const faster = await mcp.call("log_workout", { date: daysAgo(3), exercises: [{ exercise: "Running", sets: [{ distance: 5, duration_sec: 1440 }] }] });
    expect(faster.new_prs).toEqual(["Running: fastest pace 4:48 /km, previous 5:00 /km"]);
    const longer = await mcp.call("log_workout", { exercises: [{ exercise: "Running", sets: [{ distance: 10, duration_sec: 3300 }] }] });
    expect(longer.new_prs).toEqual(expect.arrayContaining(["Running: longest distance 10 km, previous 5 km", "Running: longest duration 55:00, previous 25:00"]));
    const rec = (await mcp.call("personal_records", { exercise: "Running" })).records[0];
    expect(rec).toMatchObject({ longest_distance: { distance: 10 }, fastest_pace: { pace: "4:48 /km" } });
  });
});

describe("exercise progress", () => {
  it("reports per-session best sets, e1RM and trend", async () => {
    const { mcp } = await newUser();
    await mcp.call("log_workout", { date: daysAgo(20), exercises: [{ exercise: "Squat", sets: [{ reps: 5, weight: 100, count: 3 }] }] });
    await mcp.call("log_workout", { date: daysAgo(10), exercises: [{ exercise: "Squat", sets: [{ reps: 5, weight: 105, count: 3 }] }] });
    await mcp.call("log_workout", { date: daysAgo(1), exercises: [{ exercise: "Squat", sets: [{ reps: 5, weight: 110, count: 3 }, { reps: 3, weight: 50, is_warmup: true }] }] });
    const p = await mcp.call("exercise_progress", { exercise: "squat" });
    expect(p.metric).toBe("estimated 1RM (Epley)");
    expect(p.sessions.map((s: any) => s.e1rm)).toEqual([116.7, 122.5, 128.3]);
    expect(p.sessions[2]).toMatchObject({ best_set: "110 kg × 5", top_weight: 110, working_sets: 3, reps: 15, volume: 1650 });
    expect(p.summary).toMatchObject({ sessions: 3, first: 116.7, last: 128.3, best: 128.3, change: 11.6, change_percent: 10, trend: "improving", total_volume: 4725 });

    const short = await mcp.call("exercise_progress", { exercise: "Squat", period: "last_7_days" });
    expect(short.summary.trend).toBe("not enough data");
    expect(await mcp.callError("exercise_progress", { exercise: "Snatch" })).toMatch(/No exercise/);
  });

  it("uses distance for cardio and asks when a name is ambiguous", async () => {
    const { mcp } = await newUser();
    await mcp.call("log_workout", { date: daysAgo(4), exercises: [{ exercise: "Cycling", sets: [{ distance: 20, duration_sec: 3600 }] }] });
    await mcp.call("log_workout", { date: daysAgo(2), exercises: [{ exercise: "Cycling", sets: [{ distance: 18, duration_sec: 3600 }] }] });
    const p = await mcp.call("exercise_progress", { exercise: "Cycling" });
    expect(p).toMatchObject({ metric: "distance", unit: "km", summary: { first: 20, last: 18, trend: "declining" } });

    await mcp.call("log_workout", { exercises: [{ exercise: "Bicep Curl", sets: [{ reps: 10, weight: 12 }] }, { exercise: "Hammer Curl", sets: [{ reps: 10, weight: 14 }] }] });
    expect(await mcp.callError("exercise_progress", { exercise: "curl" })).toMatch(/Several exercises match/);
  });

  it("renames and merges exercises", async () => {
    const { mcp } = await newUser();
    await mcp.call("log_workout", { date: daysAgo(2), exercises: [{ exercise: "Flat Bench", sets: [{ reps: 5, weight: 90 }] }] });
    await mcp.call("log_workout", { exercises: [bench([{ reps: 5, weight: 95 }])] });
    await mcp.call("set_goal", { type: "exercise_weight", exercise: "Flat Bench", target: 100 });
    const merged = await mcp.call("update_exercise", { exercise: "Flat Bench", new_name: "bench press" });
    expect(merged).toMatchObject({ merged: "Flat Bench", into: "Bench Press" });
    expect((await mcp.call("exercise_progress", { exercise: "Bench Press" })).summary.sessions).toBe(2);
    expect((await mcp.call("list_goals"))[0]).toMatchObject({ exercise: "Bench Press", current: 95 });
    const renamed = await mcp.call("update_exercise", { exercise: "Bench Press", new_name: "Barbell Bench Press", muscle_group: "Chest" });
    expect(renamed).toMatchObject({ name: "Barbell Bench Press", muscle_group: "chest" });
  });
});

describe("routines", () => {
  it("creates, schedules, starts and logs routines", async () => {
    const { mcp } = await newUser();
    const todayDay = WEEKDAYS[weekday(today())];
    const otherDay = WEEKDAYS[(weekday(today()) + 3) % 7];
    const r = await mcp.call("create_routine", {
      name: "Push day",
      days: [todayDay, otherDay],
      exercises: [
        { exercise: "Bench Press", sets: 4, reps: 8, weight: 70, muscle_group: "chest" },
        { exercise: "Overhead Press", sets: 3, reps: 10, weight: 40 },
        { exercise: "Dips", sets: 3, reps: 12 },
      ],
    });
    expect(r).toMatchObject({ name: "Push day", scheduled_today: true });
    expect(r.days.sort()).toEqual([todayDay, otherDay].sort());
    expect(r.exercises[0]).toMatchObject({ exercise: "Bench Press", sets: 4, reps: 8, weight: 70, target: "4 × 8 @ 70 kg" });
    await mcp.call("create_routine", { name: "Leg day", exercises: [{ exercise: "Squat", sets: 5, reps: 5, weight: 100 }] });

    const routines = await mcp.call("list_routines");
    expect(routines.map((x: any) => x.name)).toEqual(["Leg day", "Push day"]);

    // previous performance drives the suggestion
    await mcp.call("log_workout", { date: daysAgo(3), routine: "push day", exercises: [bench([{ reps: 8, weight: 70, count: 4 }])] });
    const plan = await mcp.call("start_routine_workout", {});
    expect(plan.routine).toBe("Push day");
    expect(plan.plan[0]).toMatchObject({ exercise: "Bench Press", last_time: { date: daysAgo(3), best_set: "70 kg × 8", working_sets: 4 } });
    expect(plan.plan[0].suggestion).toMatch(/try 72\.5 kg/);
    expect(plan.plan[2].last_time).toBeNull();

    const logged = await mcp.call("start_routine_workout", { routine: "Push day", log: true, duration_min: 55, effort: 7 });
    expect(logged.workout).toMatchObject({ name: "Push day", routine: "Push day", duration_min: 55 });
    expect(logged.workout.totals.working_sets).toBe(10);
    expect(logged.workout.exercises[2].sets[0]).toMatchObject({ reps: 12 });

    const f = await mcp.call("follow_up");
    expect(f.scheduled_today).toEqual([{ routine: "Push day", done_today: true }]);

    // replacing keeps one routine with the new exercise list
    await mcp.call("create_routine", { name: "push DAY", days: [otherDay], exercises: [{ exercise: "Incline Bench", sets: 3, reps: 10 }] });
    const replaced = (await mcp.call("list_routines")).find((x: any) => x.name.toLowerCase() === "push day");
    expect(replaced.exercises.map((e: any) => e.exercise)).toEqual(["Incline Bench"]);
    expect(replaced.last_done).toBe(today());

    await mcp.call("delete_routine", { routine: "Push day" });
    expect((await mcp.call("list_routines")).map((x: any) => x.name)).toEqual(["Leg day"]);
    expect((await mcp.call("list_workouts", { period: "last_7_days" })).count).toBe(2);
    expect(await mcp.callError("delete_routine", { routine: "Push day" })).toMatch(/No routine/);
    expect(await mcp.callError("start_routine_workout", {})).toMatch(/No routine scheduled today/);
  });

  it("rejects bad weekdays", async () => {
    const { mcp } = await newUser();
    await expect(mcp.call("create_routine", { name: "X", days: ["monday"], exercises: [{ exercise: "Squat" }] })).rejects.toThrow();
    await expect(mcp.call("create_routine", { name: "X", exercises: [] })).rejects.toThrow();
  });
});

describe("body metrics", () => {
  it("records metrics, overwrites the same day and reports change", async () => {
    const { mcp } = await newUser();
    await mcp.call("log_body_metric", { date: daysAgo(20), weight: 82, body_fat_pct: 20, waist: 90 });
    await mcp.call("log_body_metric", { date: daysAgo(10), weight: 81 });
    const res = await mcp.call("log_body_metric", { weight: 80.4, resting_hr: 58 });
    expect(res.logged.find((l: any) => l.metric === "weight")).toMatchObject({ value: 80.4, unit: "kg", previous: { date: daysAgo(10), value: 81 }, change: -0.6 });
    await mcp.call("log_body_metric", { weight: 80.2 });

    const hist = await mcp.call("body_metrics_history", { period: "last_30_days" });
    const w = hist.metrics.find((m: any) => m.metric === "weight");
    expect(w).toMatchObject({ first: { value: 82 }, latest: { value: 80.2 }, change: -1.8, min: 80.2, max: 82 });
    expect(w.entries).toHaveLength(3);
    expect(hist.metrics.map((m: any) => m.metric)).toEqual(["weight", "body_fat_pct", "waist", "resting_hr"]);
    expect((await mcp.call("body_metrics_history", { metric: "waist" })).metrics).toHaveLength(1);

    await mcp.call("delete_body_metric", { metric: "resting_hr", date: today() });
    expect(await mcp.callError("delete_body_metric", { metric: "resting_hr", date: today() })).toMatch(/No resting_hr/);
    expect(await mcp.callError("log_body_metric", {})).toMatch(/at least one metric/);
    await expect(mcp.call("log_body_metric", { weight: -3 })).rejects.toThrow();
    await expect(mcp.call("log_body_metric", { body_fat_pct: 90 })).rejects.toThrow();
  });
});

describe("goals", () => {
  it("computes progress for each goal type", async () => {
    const { mcp } = await newUser();
    await mcp.call("log_body_metric", { date: daysAgo(10), weight: 80 });
    await mcp.call("log_workout", { duration_min: 40, exercises: [bench([{ reps: 5, weight: 105 }])] });
    await mcp.call("log_workout", { duration_min: 20, exercises: [{ exercise: "Pull-up", sets: [{ reps: 12 }] }] });

    const weekly = await mcp.call("set_goal", { type: "workouts_per_week", target: 3 });
    expect(weekly).toMatchObject({ current: 2, target: 3, percent: 67, achieved: false, description: "3 workouts per week: 2 workouts this week (67%)" });
    const lift = await mcp.call("set_goal", { type: "exercise_weight", exercise: "bench", target: 120, deadline: addDays(today(), 60) });
    expect(lift).toMatchObject({ exercise: "Bench Press", current: 105, target: 120, unit: "kg", percent: 88, days_left: 60, description: "Bench Press 120 kg: 105 kg (88%)" });
    const reps = await mcp.call("set_goal", { type: "exercise_reps", exercise: "Pull-up", target: 12 });
    expect(reps).toMatchObject({ percent: 100, achieved: true });
    const bw = await mcp.call("set_goal", { type: "body_weight", target: 75 });
    expect(bw).toMatchObject({ start: 80, current: 80, direction: "decrease", percent: 0 });
    await mcp.call("log_body_metric", { weight: 77.5 });
    const minutes = await mcp.call("set_goal", { type: "minutes_per_week", target: 120 });
    expect(minutes).toMatchObject({ current: 60, percent: 50 });
    await mcp.call("set_goal", { type: "total_volume_per_week", target: 1000 });
    // a brand-new exercise goal creates the exercise
    expect(await mcp.call("set_goal", { type: "exercise_weight", exercise: "Front Squat", target: 80 })).toMatchObject({ current: 0, percent: 0 });

    const goals = await mcp.call("list_goals");
    expect(goals).toHaveLength(7);
    expect(goals.find((g: any) => g.type === "body_weight")).toMatchObject({ current: 77.5, percent: 50 });
    expect(goals.find((g: any) => g.type === "total_volume_per_week")).toMatchObject({ current: 525, percent: 53 });

    // updating the same goal replaces its target
    expect(await mcp.call("set_goal", { type: "workouts_per_week", target: 2 })).toMatchObject({ percent: 100, achieved: true });
    expect(await mcp.call("list_goals")).toHaveLength(7);

    await mcp.call("delete_goal", { id: weekly.id });
    expect(await mcp.call("list_goals")).toHaveLength(6);
    expect(await mcp.callError("delete_goal", { id: weekly.id })).toMatch(/not found/);
    expect(await mcp.callError("set_goal", { type: "exercise_weight", target: 100 })).toMatch(/need an exercise/);
    await expect(mcp.call("set_goal", { type: "workouts_per_week", target: 0 })).rejects.toThrow();
    await expect(mcp.call("set_goal", { type: "marathon", target: 1 })).rejects.toThrow();
  });
});

describe("follow-up", () => {
  it("nudges a brand-new user", async () => {
    const { mcp } = await newUser();
    const f = await mcp.call("follow_up");
    expect(f).toMatchObject({ days_since_last_workout: null, last_workout: null, streak: { weeks: 0, days: 0 } });
    expect(f.nudges.join(" ")).toMatch(/No workouts logged yet/);
    expect(f.nudges.join(" ")).toMatch(/No weekly workout goal/);
  });

  it("reports streaks, neglected muscle groups, PRs, goals and weight trend", async () => {
    const { mcp } = await newUser();
    await mcp.call("set_goal", { type: "workouts_per_week", target: 1 });
    await mcp.call("log_workout", { date: daysAgo(21), exercises: [{ exercise: "Squat", sets: [{ reps: 5, weight: 100 }] }] });
    await mcp.call("log_workout", { date: daysAgo(14), exercises: [{ exercise: "Squat", sets: [{ reps: 5, weight: 110 }] }] });
    await mcp.call("log_workout", { date: daysAgo(10), exercises: [{ exercise: "Squat", sets: [{ reps: 5, weight: 115 }] }] });
    await mcp.call("log_workout", { date: daysAgo(4), exercises: [bench([{ reps: 5, weight: 80 }])] });
    await mcp.call("log_workout", { date: daysAgo(3), exercises: [bench([{ reps: 5, weight: 85 }])] });
    await mcp.call("log_body_metric", { date: daysAgo(20), weight: 84 });
    await mcp.call("log_body_metric", { date: daysAgo(2), weight: 82.5 });

    const f = await mcp.call("follow_up");
    expect(f.days_since_last_workout).toBe(3);
    expect(f.last_workout).toMatchObject({ date: daysAgo(3), days_ago: 3 });
    expect(f.neglected_muscle_groups).toEqual([{ muscle_group: "legs", last_trained: daysAgo(10), days_ago: 10 }]);
    expect(f.recent_prs.map((p: any) => p.record)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Bench Press: heaviest weight 85 kg/), expect.stringMatching(/Squat: heaviest weight 115 kg/)]),
    );
    // squat on day -14 is exactly 14 days ago → outside the 14-day window (today counts as day 1)
    expect(f.recent_prs.every((p: any) => p.date >= daysAgo(13))).toBe(true);
    expect(f.recent_prs.some((p: any) => p.date === daysAgo(14))).toBe(false);
    expect(f.body_weight).toMatchObject({ latest: 82.5, unit: "kg", change_30_days: -1.5, trend: "down" });
    expect(f.goals).toHaveLength(1);

    // weeks: every week from 3 weeks ago has a workout; this week may or may not, depending on the weekday
    const thisWeek = startOfWeek(today());
    const loggedThisWeek = [21, 14, 10, 4, 3].some((d) => daysAgo(d) >= thisWeek);
    expect(f.streak.weekly_target).toBe(1);
    expect(f.streak.weeks).toBeGreaterThanOrEqual(3);
    expect(f.streak.current_week_met).toBe(loggedThisWeek);
    expect(f.streak.days).toBe(0);

    const text = f.nudges.join("\n");
    expect(text).toMatch(/It's been 3 days since your last workout/);
    expect(text).toMatch(/You haven't trained legs in 10 days/);
    expect(text).toMatch(/new PRs? in the last 14 days/);
  });

  it("counts a day streak and the weekly goal", async () => {
    const { mcp } = await newUser();
    await mcp.call("set_goal", { type: "workouts_per_week", target: 5 });
    await mcp.call("log_workout", { date: daysAgo(1), duration_min: 30 });
    await mcp.call("log_workout", { duration_min: 30 });
    const f = await mcp.call("follow_up");
    expect(f.streak.days).toBe(2);
    const thisWeek = [0, 1].filter((d) => daysAgo(d) >= startOfWeek(today())).length;
    expect(f.this_week).toMatchObject({ workouts: thisWeek, goal: 5, minutes: thisWeek * 30 });
    expect(f.nudges.join(" ")).toMatch(new RegExp(`${thisWeek} of 5 workouts done this week, ${5 - thisWeek} to go`));
  });
});

describe("reports", () => {
  it("generates an organized report with every section and a printable link", async () => {
    const { mcp } = await newUser();
    await mcp.call("set_goal", { type: "workouts_per_week", target: 2 });
    await mcp.call("log_workout", { name: "Push", date: daysAgo(6), duration_min: 50, effort: 7, exercises: [bench([{ reps: 5, weight: 90, count: 3 }])] });
    await mcp.call("log_workout", { name: "Legs", date: daysAgo(4), duration_min: 60, effort: 8, exercises: [{ exercise: "Squat", sets: [{ reps: 5, weight: 120, count: 3 }] }] });
    await mcp.call("log_workout", { name: "Push", date: daysAgo(1), duration_min: 55, effort: 9, exercises: [bench([{ reps: 5, weight: 95, count: 3 }])] });
    await mcp.call("log_body_metric", { date: daysAgo(6), weight: 81 });
    await mcp.call("log_body_metric", { date: daysAgo(1), weight: 80 });
    const md = await mcp.text("generate_report", { period: "last_7_days" });
    for (const heading of [
      "# Workout Report",
      "## Training volume by muscle group",
      "## Sessions log",
      "## Top exercises",
      "## Personal records",
      "## Exercise progress",
      "## Body metrics",
      "## Goals",
      "## Weekly consistency",
    ])
      expect(md).toContain(heading);
    expect(md).toMatch(/\| Sessions \| Total time \| Total volume \| Avg effort \| Consistency \| PRs \|/);
    expect(md).toMatch(/\*\*3\*\*/);
    expect(md).toMatch(/\*\*2h 45m\*\*/);
    expect(md).toMatch(/\*\*4,575 kg\*\*/);
    expect(md).toMatch(/\*\*8\/10\*\*/);
    expect(md).toMatch(/\*\*\d active days\*\* \(\d\/\d+ (full )?weeks? ≥ 2\/wk\)/);
    expect(md).toMatch(/Bench Press estimated 1RM up 6% \(105 kg → 110\.8 kg\)/);
    expect(md).toMatch(/personal records? set/);
    expect(md).toMatch(/Most-trained muscle group: Chest/);
    expect(md).toMatch(/\| Body weight \| 81 kg/);
    expect(md).toMatch(/http:\/\/localhost:8789\/reports\/[a-f0-9]{40}/);
  });

  it("shows empty-state messages for a user with no data", async () => {
    const { mcp } = await newUser();
    const md = await mcp.text("generate_report", { period: "this_month" });
    expect(md).toContain("No workouts logged in this period yet.");
    expect(md).toContain("_No sets logged in this period._");
    expect(md).toContain("_No body metrics logged in this period._");
    expect(md).toContain("_No goals set.");
    expect(md).toContain("_No workouts in this period, so no weekly consistency to show yet._");
  });

  it("compares against the previous period", async () => {
    const { mcp } = await newUser();
    await mcp.call("log_workout", { date: daysAgo(10), exercises: [bench([{ reps: 5, weight: 100 }])] });
    await mcp.call("log_workout", { date: daysAgo(2), exercises: [bench([{ reps: 5, weight: 100, count: 2 }])] });
    const md = await mcp.text("generate_report", { period: "last_7_days" });
    expect(md).toMatch(/1 session vs 1 in the previous 7 days; volume ▲ 100% \(500 kg before\)/);
  });
});

describe("isolation and lifecycle", () => {
  it("never shows or changes one user's data for another", async () => {
    const a = await newUser();
    const b = await newUser();
    const { workout } = await a.mcp.call("log_workout", { exercises: [bench([{ reps: 5, weight: 100 }])] });
    const setId = workout.exercises[0].sets[0].id;
    const goal = await a.mcp.call("set_goal", { type: "workouts_per_week", target: 3 });
    await a.mcp.call("create_routine", { name: "Secret plan", exercises: [{ exercise: "Bench Press" }] });
    await a.mcp.call("log_body_metric", { weight: 90 });

    expect((await b.mcp.call("list_workouts")).count).toBe(0);
    expect(await b.mcp.callError("get_workout", { id: workout.id })).toMatch(/not found/);
    expect(await b.mcp.callError("update_workout", { id: workout.id, name: "hacked" })).toMatch(/not found/);
    expect(await b.mcp.callError("delete_workout", { id: workout.id })).toMatch(/not found/);
    expect(await b.mcp.callError("delete_set", { id: setId })).toMatch(/not found/);
    expect(await b.mcp.callError("update_set", { id: setId, reps: 1 })).toMatch(/not found/);
    expect(await b.mcp.callError("add_sets", { workout_id: workout.id, exercises: [{ exercise: "X", sets: [{ reps: 1 }] }] })).toMatch(/not found/);
    expect(await b.mcp.callError("delete_goal", { id: goal.id })).toMatch(/not found/);
    expect(await b.mcp.callError("delete_routine", { routine: "Secret plan" })).toMatch(/No routine/);
    expect(await b.mcp.call("list_exercises")).toEqual([]);
    expect(await b.mcp.call("list_routines")).toEqual([]);
    expect(await b.mcp.call("list_goals")).toEqual([]);
    expect((await b.mcp.call("body_metrics_history")).metrics).toEqual([]);
    expect((await b.mcp.call("personal_records")).records).toEqual([]);
    expect(await b.mcp.callError("exercise_progress", { exercise: "Bench Press" })).toMatch(/No exercise/);

    // A's data is intact
    expect((await a.mcp.call("get_workout", { id: workout.id })).name).toBe("Workout");
    expect(await a.mcp.call("list_goals")).toHaveLength(1);
  });

  it("purges data of deleted accounts", async () => {
    const { mcp, userId } = await newUser();
    await mcp.call("log_workout", { exercises: [bench([{ reps: 5, weight: 100 }])] });
    await mcp.call("create_routine", { name: "Push", exercises: [{ exercise: "Bench Press" }] });
    await mcp.call("log_body_metric", { weight: 80 });
    await mcp.call("set_goal", { type: "exercise_weight", exercise: "Bench Press", target: 120 });
    await mcp.text("generate_report", {});
    const removed = await purgeDeletedUsers({ DB: env.DB, AUTH: fakeAuth(TEST_USER, [userId]), PUBLIC_URL: "", AUTH_URL: "" }, USER_TABLES);
    expect(removed).toBe(1);
    for (const t of [...USER_TABLES, "reports"]) expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).bind(userId).first("n")).toBe(0);
  });

  it("exposes profile tools", async () => {
    const { mcp } = await newUser();
    expect(await mcp.callError("update_profile", { timezone: "Mars/Olympus" })).toMatch(/Unknown time zone/);
    const p = await mcp.call("update_profile", { units: "imperial" });
    expect(p.units).toBe("imperial");
    // the change applies immediately to this session
    const res = await mcp.call("log_workout", { exercises: [bench([{ reps: 5, weight: 135 }])] });
    expect(res.workout.exercises[0].sets[0]).toMatchObject({ weight: 135, display: "135 lb × 5" });
  });
});

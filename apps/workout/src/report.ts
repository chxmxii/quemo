import { addDays, round, startOfWeek, TOOLS, type DateRange, type Report, type Section, type ToolContext } from "@quemo/core";
import { fmtSummary, goalProgress, metricHistory, workoutSummaries, type Env } from "./server";
import { describePr, fmtMinutes, fmtVolume, fmtWeight, loadSets, PR_LABELS, prEvents, prValue, summarize, trendOf, weeklyCounts, weightUnit, type ExerciseSession } from "./stats";

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

function change(current: number, previous: number): string {
  if (!previous) return current ? "new" : "—";
  const d = ((current - previous) / previous) * 100;
  return `${d > 0 ? "▲" : d < 0 ? "▼" : "="} ${Math.abs(Math.round(d))}%`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");

export async function buildReport(ctx: ToolContext<Env>, range: DateRange): Promise<Report> {
  const { env, user } = ctx;
  const db = env.DB;
  const uid = user.id;
  const u = user.units;
  const wu = weightUnit(u);
  const vol = (kg: number) => fmtVolume(kg, u);

  // Previous period of the same length, for comparisons.
  const prev = { from: addDays(range.from, -range.days), to: addDays(range.from, -1) };

  const [workouts, prevWorkouts, rows, history, goals, metrics] = await Promise.all([
    workoutSummaries(db, uid, range.from, range.to),
    workoutSummaries(db, uid, prev.from, prev.to),
    loadSets(db, uid, { from: range.from, to: range.to }),
    loadSets(db, uid, { to: range.to }),
    goalProgress(db, uid, range.to, u),
    metricHistory(db, uid, range.from, range.to, u),
  ]);
  const sessions = summarize(rows).filter((s) => s.sets > 0);
  const prs = prEvents(summarize(history)).filter((e) => e.date >= range.from && e.date <= range.to);

  const minutes = workouts.reduce((n, w) => n + (w.duration_min ?? 0), 0);
  const volume = workouts.reduce((n, w) => n + w.volume_kg, 0);
  const prevVolume = prevWorkouts.reduce((n, w) => n + w.volume_kg, 0);
  const efforts = workouts.filter((w) => w.effort !== null).map((w) => w.effort!);
  const avgEffort = efforts.length ? round(efforts.reduce((a, b) => a + b, 0) / efforts.length, 1) : null;
  const activeDays = new Set(workouts.map((w) => w.date)).size;
  const weeklyGoal = goals.find((g) => g.type === "workouts_per_week");
  const weeklyTarget = weeklyGoal ? Number(weeklyGoal.target) : 1;

  // ----- weekly consistency -----
  const weekStarts: string[] = [];
  for (let w = startOfWeek(range.from); w <= range.to; w = addDays(w, 7)) weekStarts.push(w);
  const counts = await weeklyCounts(db, uid, range.from, range.to);
  const weekVolume = new Map<string, number>();
  for (const w of workouts) weekVolume.set(startOfWeek(w.date), (weekVolume.get(startOfWeek(w.date)) ?? 0) + w.volume_kg);
  // Weeks cut off by the period edges are shown but only full weeks count towards consistency (unless there are none).
  const isFull = (w: string) => w >= range.from && addDays(w, 6) <= range.to;
  const fullWeeks = weekStarts.filter(isFull);
  const scoredWeeks = fullWeeks.length ? fullWeeks : weekStarts;
  const weeksMet = scoredWeeks.filter((w) => (counts.get(w)?.n ?? 0) >= weeklyTarget).length;

  // ----- per muscle group -----
  const groups = new Map<string, { sets: number; volume: number; workouts: Set<string> }>();
  for (const s of sessions) {
    const g = s.muscle_group ?? "other";
    const e = groups.get(g) ?? { sets: 0, volume: 0, workouts: new Set<string>() };
    e.sets += s.sets;
    e.volume += s.volume_kg;
    e.workouts.add(s.workout_id);
    groups.set(g, e);
  }
  const byGroup = [...groups].sort((a, b) => b[1].sets - a[1].sets || b[1].volume - a[1].volume);
  const totalSets = byGroup.reduce((n, [, g]) => n + g.sets, 0);

  // ----- per exercise -----
  const exMap = new Map<string, { name: string; group: string | null; list: ExerciseSession[] }>();
  for (const s of sessions) {
    const e = exMap.get(s.exercise_id) ?? { name: s.exercise, group: s.muscle_group, list: [] };
    e.list.push(s);
    exMap.set(s.exercise_id, e);
  }
  const exercises = [...exMap.values()]
    .map((e) => {
      const best = e.list.reduce((a, b) => (b.best_e1rm > a.best_e1rm ? b : a));
      const withE1rm = e.list.filter((s) => s.best_e1rm > 0);
      return {
        ...e,
        sets: e.list.reduce((n, s) => n + s.sets, 0),
        reps: e.list.reduce((n, s) => n + s.reps, 0),
        volume: e.list.reduce((n, s) => n + s.volume_kg, 0),
        best,
        first: withE1rm[0]?.best_e1rm ?? 0,
        last: withE1rm.at(-1)?.best_e1rm ?? 0,
        e1rmSessions: withE1rm.length,
      };
    })
    .sort((a, b) => b.sets - a.sets || b.volume - a.volume);

  const improvements = exercises
    .filter((e) => e.e1rmSessions >= 2 && e.last > e.first)
    .map((e) => ({ ...e, gain: ((e.last - e.first) / e.first) * 100 }))
    .sort((a, b) => b.gain - a.gain);

  // ----- highlights -----
  const highlights: string[] = [];
  if (!workouts.length) highlights.push("No workouts logged in this period yet.");
  if (prs.length) highlights.push(`${prs.length} personal record${prs.length > 1 ? "s" : ""} set — latest: ${describePr(prs.at(-1)!, u)}.`);
  for (const e of improvements.slice(0, 2)) highlights.push(`${e.name} estimated 1RM up ${Math.round(e.gain)}% (${fmtWeight(e.first, u)} → ${fmtWeight(e.last, u)}).`);
  if (prevWorkouts.length || workouts.length)
    highlights.push(
      `${workouts.length} session${workouts.length === 1 ? "" : "s"} vs ${prevWorkouts.length} in the previous ${range.days} days` +
        (prevVolume ? `; volume ${change(volume, prevVolume)} (${vol(prevVolume)} before).` : "."),
    );
  if (byGroup[0]) highlights.push(`Most-trained muscle group: ${cap(byGroup[0][0])} (${byGroup[0][1].sets} working sets, ${pct(byGroup[0][1].sets, totalSets)}%).`);
  for (const g of goals.filter((x) => x.achieved)) highlights.push(`Goal achieved: ${g.description.replace(/ — achieved$/, "")}.`);

  const sections: Section[] = [];

  sections.push({
    title: "Training volume by muscle group",
    bars: byGroup.map(([g, v]) => ({ label: cap(g), value: v.sets, max: byGroup[0][1].sets, display: `${v.sets} set${v.sets === 1 ? "" : "s"} · ${vol(v.volume)}` })),
    table: {
      columns: ["Muscle group", "Working sets", "Share", "Volume", "Sessions"],
      rows: byGroup.map(([g, v]) => [cap(g), v.sets, `${pct(v.sets, totalSets)}%`, vol(v.volume), v.workouts.size]),
      numeric: [1, 2, 3, 4],
    },
    empty: "No sets logged in this period.",
  });

  sections.push({
    title: "Sessions log",
    table: {
      columns: ["Date", "Workout", "Duration", "Effort", "Exercises", "Sets", "Volume", "Muscle groups"],
      rows: [...workouts].reverse().map((w) => {
        const f = fmtSummary(w, u);
        return [f.date, f.name, f.duration_min ? fmtMinutes(f.duration_min) : null, f.effort ? `${f.effort}/10` : null, f.exercises, f.working_sets, vol(w.volume_kg), f.muscle_groups.map(cap).join(", ")];
      }),
      numeric: [2, 3, 4, 5, 6],
    },
    empty: "No workouts logged in this period.",
  });

  const bestSet = (s: ExerciseSession) =>
    s.e1rm_set ? `${fmtWeight(s.e1rm_set.weight, u)} × ${s.e1rm_set.reps}` : s.max_distance ? prValue("longest_distance", s.max_distance, u) : s.max_reps ? `${s.max_reps} reps` : s.max_duration ? prValue("longest_duration", s.max_duration, u) : null;
  sections.push({
    title: "Top exercises",
    table: {
      columns: ["Exercise", "Muscle group", "Sessions", "Sets", "Reps", "Volume", "Best set", "Best e1RM"],
      rows: exercises.slice(0, 15).map((e) => [e.name, e.group ? cap(e.group) : null, e.list.length, e.sets, e.reps, vol(e.volume), bestSet(e.best), e.best.best_e1rm ? fmtWeight(e.best.best_e1rm, u) : null]),
      numeric: [2, 3, 4, 5, 7],
    },
    empty: "No exercises logged in this period.",
  });

  sections.push({
    title: "Personal records",
    table: {
      columns: ["Date", "Exercise", "Record", "New", "Previous"],
      rows: [...prs].reverse().map((e) => [
        e.date,
        e.exercise,
        e.kind === "most_reps_at_weight" ? `${PR_LABELS[e.kind]} ${e.weight ? `at ${fmtWeight(e.weight, u)}` : "(bodyweight)"}` : PR_LABELS[e.kind],
        prValue(e.kind, e.value, u),
        prValue(e.kind, e.previous, u),
      ]),
      numeric: [3, 4],
    },
    empty: "No new personal records in this period — PRs appear once an exercise beats an earlier session.",
  });

  const lifts = exercises.filter((e) => e.e1rmSessions > 0).slice(0, 8);
  sections.push({
    title: "Exercise progress",
    text: lifts.length ? `Estimated 1RM (Epley) of your most-trained lifts, first → last session in the period (${wu}).` : undefined,
    table: {
      columns: ["Exercise", "Sessions", "First e1RM", "Last e1RM", "Change", "Trend"],
      rows: lifts.map((e) => [e.name, e.e1rmSessions, fmtWeight(e.first, u), fmtWeight(e.last, u), e.e1rmSessions >= 2 ? change(e.last, e.first) : "—", trendOf(e.first, e.last, e.e1rmSessions)]),
      numeric: [1, 2, 3, 4],
    },
    empty: "No weighted lifts logged in this period.",
  });

  sections.push({
    title: "Body metrics",
    table: {
      columns: ["Metric", "First", "Latest", "Change", "Range", "Entries"],
      rows: metrics.map((m) => [
        m.label,
        `${m.first_display} (${m.first.date})`,
        `${m.latest_display} (${m.latest.date})`,
        `${m.change > 0 ? "+" : ""}${m.change}${m.unit === "%" ? " pts" : ` ${m.unit}`}`,
        `${m.min} – ${m.max}`,
        m.entries.length,
      ]),
      numeric: [3, 5],
    },
    empty: "No body metrics logged in this period.",
  });

  sections.push({
    title: "Goals",
    bars: goals.map((g) => ({ label: g.label + (g.exercise ? ` · ${g.exercise}` : ""), value: g.percent, max: 100, display: `${g.current ?? "—"} / ${g.target} ${g.unit} (${g.percent}%)`, tone: g.achieved ? "good" : g.percent < 50 ? "warn" : undefined })),
    table: {
      columns: ["Goal", "Current", "Target", "Progress", "Deadline"],
      rows: goals.map((g) => [g.label + (g.exercise ? ` · ${g.exercise}` : ""), g.current === null ? null : `${g.current} ${g.unit}`, `${g.target} ${g.unit}`, `${g.percent}%${g.achieved ? " ✓" : ""}`, g.deadline]),
      numeric: [1, 2, 3],
    },
    empty: "No goals set. Ask your assistant to set a weekly workout goal or a lift target.",
  });

  sections.push({
    title: "Weekly consistency",
    text: workouts.length ? `Target: ${weeklyTarget} workout${weeklyTarget === 1 ? "" : "s"} per week${weeklyGoal ? "" : " (no weekly goal set, so any workout counts)"}.` : undefined,
    table: {
      columns: ["Week of", "Sessions", "Time", "Volume", "Target met"],
      rows: workouts.length
        ? weekStarts.map((w) => {
            const c = counts.get(w);
            return [isFull(w) ? w : `${w} (partial)`, c?.n ?? 0, c?.minutes ? fmtMinutes(c.minutes) : null, vol(weekVolume.get(w) ?? 0), (c?.n ?? 0) >= weeklyTarget ? "✓" : "✗"];
          })
        : [],
      numeric: [1, 2, 3],
    },
    empty: "No workouts in this period, so no weekly consistency to show yet.",
  });

  return {
    tool: TOOLS.workout.name,
    title: "Workout Report",
    subtitle: user.name ?? user.email,
    period: { from: range.from, to: range.to, label: range.label },
    kpis: [
      { label: "Sessions", value: String(workouts.length), detail: prevWorkouts.length ? `${change(workouts.length, prevWorkouts.length)} vs prev.` : undefined, tone: workouts.length ? "good" : "neutral" },
      { label: "Total time", value: minutes ? fmtMinutes(minutes) : "—", detail: minutes && workouts.length ? `avg ${Math.round(minutes / workouts.length)} min` : undefined },
      { label: "Total volume", value: vol(volume), detail: prevVolume ? `${change(volume, prevVolume)} vs prev.` : undefined },
      { label: "Avg effort", value: avgEffort === null ? "—" : `${avgEffort}/10`, tone: avgEffort === null ? "neutral" : avgEffort >= 9 ? "warn" : "good" },
      {
        label: "Consistency",
        value: `${activeDays} active day${activeDays === 1 ? "" : "s"}`,
        detail: `${weeksMet}/${scoredWeeks.length} ${fullWeeks.length ? "full " : ""}week${scoredWeeks.length === 1 ? "" : "s"} ≥ ${weeklyTarget}/wk`,
        tone: weeksMet === scoredWeeks.length ? "good" : weeksMet ? "warn" : "bad",
      },
      { label: "PRs", value: String(prs.length), tone: prs.length ? "good" : "neutral" },
    ],
    highlights,
    sections,
    disclaimer: `Volume = weight × reps of working sets (warm-ups excluded), in ${wu}. Estimated 1RM uses the Epley formula.`,
  };
}


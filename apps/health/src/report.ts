import { addDays, TOOLS, type DateRange, type Report, type Section, type Tone, type ToolContext } from "@quemo/core";
import {
  countedSlots,
  daysOfSupply,
  DISCLAIMER,
  fmtAppt,
  loadAppointments,
  loadProfile,
  loadSymptoms,
  loadVitals,
  medicationData,
  nowLocal,
  refillNeeded,
  scheduleText,
  symptomSummary,
  vitalFlag,
  vitalLabel,
  vitalStats,
  vitalValue,
  type Env,
} from "./server";

export const adherenceTone = (pct: number | null): Tone => (pct === null ? "neutral" : pct >= 90 ? "good" : pct >= 75 ? "warn" : "bad");

const TREND_ARROW: Record<string, string> = { rising: "↑ rising", falling: "↓ falling", stable: "→ stable", "not enough data": "-" };

export async function buildReport(ctx: ToolContext<Env>, range: DateRange): Promise<Report> {
  const { env, user } = ctx;
  const db = env.DB;
  const uid = user.id;
  const now = nowLocal(user.timezone);
  const today = now.date;
  const cur = `${today} ${now.time}`;

  const [profile, meds, vitals, symptoms, appts, upcoming] = await Promise.all([
    loadProfile(db, uid),
    medicationData(db, uid, range.from, range.to, now),
    loadVitals(db, uid, range.from, range.to),
    loadSymptoms(db, uid, range.from, range.to),
    loadAppointments(db, uid, `${range.from} 00:00`, `${range.to} 23:59`),
    loadAppointments(db, uid, cur, `${addDays(today, 90)} 23:59`, false),
  ]);

  const adh = meds.adherence;
  const active = meds.meds.filter((m) => m.active);
  const notTaken = countedSlots(meds.slots, now).filter((s) => s.status !== "taken");
  const missedCount = notTaken.filter((s) => s.status !== "skipped").length;
  const flagged = vitals.map((v) => ({ v, flag: vitalFlag(v) })).filter((x) => x.flag);
  const symSummary = symptomSummary(symptoms);
  const refills = active.filter(refillNeeded);
  const apptsInPeriod = appts.filter((a) => a.scheduled_at <= cur || a.status !== "scheduled");

  // ---------- highlights ----------
  const highlights: string[] = [];
  if (adh.overall_percent !== null)
    highlights.push(`Overall medication adherence was ${adh.overall_percent}% (${adh.taken} of ${adh.scheduled} scheduled doses taken).`);
  const worst = [...adh.by_medication].filter((a) => a.percent !== null && a.percent < 90).sort((a, b) => a.percent! - b.percent!)[0];
  if (worst) highlights.push(`Lowest adherence: ${worst.medication} at ${worst.percent}% (${worst.missed + worst.skipped} doses not taken).`);
  if (flagged.length) highlights.push(`${flagged.length} reading${flagged.length === 1 ? " was" : "s were"} outside the usual range, see Flagged readings.`);
  if (symSummary[0]) highlights.push(`Most frequent symptom: ${symSummary[0].symptom} (${symSummary[0].count}×, average severity ${symSummary[0].avg_severity}/10, ${symSummary[0].trend}).`);
  for (const s of symSummary.filter((x) => x.trend === "worsening").slice(0, 3)) if (s !== symSummary[0]) highlights.push(`${s.symptom} appears to be worsening.`);
  if (upcoming[0]) highlights.push(`Next appointment: ${upcoming[0].doctor}${upcoming[0].specialty ? ` (${upcoming[0].specialty})` : ""} on ${upcoming[0].scheduled_at}.`);
  if (refills.length) highlights.push(`Refill needed soon: ${refills.map((m) => m.name).join(", ")}.`);
  if (!meds.meds.length && !vitals.length && !symptoms.length && !appts.length) highlights.push("Nothing tracked in this period yet.");

  const sections: Section[] = [];

  // ---------- health profile ----------
  const profileKpis = profile.exists
    ? [
        { label: "Conditions", value: profile.conditions.join(", ") || "none recorded" },
        { label: "Allergies", value: profile.allergies.join(", ") || "none recorded" },
        ...(profile.blood_type ? [{ label: "Blood type", value: profile.blood_type }] : []),
        ...(profile.primary_doctor ? [{ label: "Primary doctor", value: profile.primary_doctor }] : []),
        ...(profile.emergency_contact ? [{ label: "Emergency contact", value: profile.emergency_contact }] : []),
        ...(profile.notes ? [{ label: "Notes", value: profile.notes }] : []),
      ]
    : [];
  sections.push({
    title: "Health profile",
    kpis: profileKpis,
    empty: "No health profile yet. Ask your assistant to record your conditions and allergies.",
  });

  // ---------- medications ----------
  sections.push({
    title: "Current medications",
    table: {
      columns: ["Medication", "Dose", "Form", "Schedule", "Purpose", "Instructions", "Prescriber", "Since", "Until"],
      rows: active.map((m) => [m.name, m.dosage, m.form, scheduleText(m), m.purpose, m.instructions, m.prescriber, m.start_date, m.end_date]),
    },
    empty: "No current medications.",
  });

  sections.push({
    title: "Adherence by medication",
    text: adh.overall_percent !== null ? `Doses taken out of scheduled doses (${adh.taken}/${adh.scheduled}, ${adh.overall_percent}% overall). Only doses due before now are counted.` : undefined,
    bars: adh.by_medication.map((a) => ({
      label: a.medication,
      value: a.percent ?? 0,
      max: 100,
      display: `${a.percent}% (${a.taken}/${a.scheduled})`,
      tone: adherenceTone(a.percent),
    })),
    table: {
      columns: ["Medication", "Scheduled", "Taken", "Skipped", "Missed", "Adherence"],
      rows: adh.by_medication.map((a) => [a.medication, a.scheduled, a.taken, a.skipped, a.missed, `${a.percent}%`]),
      numeric: [1, 2, 3, 4, 5],
    },
    empty: "No scheduled doses in this period.",
  });

  sections.push({
    title: "Missed doses",
    table: {
      columns: ["Date", "Time", "Medication", "Status", "Note"],
      rows: [...notTaken]
        .reverse()
        .slice(0, 60)
        .map((s) => [s.date, s.time, s.medication, s.logged ? s.status : "not logged", s.note]),
    },
    empty: "No missed doses, every scheduled dose was taken.",
  });

  const asNeeded = new Map<string, { count: number; last: string }>();
  for (const d of meds.extra.filter((x) => x.status === "taken")) {
    const e = asNeeded.get(d.medication) ?? { count: 0, last: d.actual_at };
    e.count++;
    if (d.actual_at > e.last) e.last = d.actual_at;
    asNeeded.set(d.medication, e);
  }
  sections.push({
    title: "As-needed & extra doses",
    table: { columns: ["Medication", "Times taken", "Last taken"], rows: [...asNeeded].map(([name, e]) => [name, e.count, e.last]), numeric: [1] },
    empty: "No as-needed or extra doses logged in this period.",
  });

  // ---------- vitals ----------
  const stats = vitalStats(vitals);
  sections.push({
    title: "Vitals summary",
    table: {
      columns: ["Measurement", "Unit", "Readings", "Average", "Min", "Max", "Latest", "Trend", "Flagged"],
      rows: stats.map((s) => [s.measurement, s.unit, s.count, s.avg, s.min, s.max, `${s.latest} (${s.latest_at})`, TREND_ARROW[s.trend] ?? s.trend, s.flagged || null]),
      numeric: [2, 3, 4, 5, 8],
    },
    empty: "No vitals or measurements logged in this period.",
  });

  sections.push({
    title: "Flagged readings",
    text: flagged.length ? "Readings outside commonly used reference ranges, worth discussing with your doctor. These are not diagnoses." : undefined,
    table: {
      columns: ["When", "Measurement", "Value", "Context", "Note"],
      rows: [...flagged].reverse().slice(0, 40).map(({ v, flag }) => [v.measured_at, vitalLabel(v), `${vitalValue(v)}${flag!.level === "urgent" ? " ⚠" : ""}`, v.context, v.note]),
    },
    empty: "No readings outside the usual ranges.",
  });

  // ---------- symptoms ----------
  sections.push({
    title: "Symptoms",
    bars: symSummary.slice(0, 10).map((s) => ({
      label: s.symptom,
      value: s.count,
      max: symSummary[0].count,
      display: `${s.count}× · avg ${s.avg_severity}/10`,
      tone: s.avg_severity >= 7 ? "bad" : s.avg_severity >= 4 ? "warn" : undefined,
    })),
    table: {
      columns: ["Symptom", "Times", "Days", "Avg severity", "Max", "Body area", "Trend", "Last"],
      rows: symSummary.map((s) => [s.symptom, s.count, s.days, s.avg_severity, s.max_severity, s.body_areas.join(", "), s.trend, s.last]),
      numeric: [1, 2, 3, 4],
    },
    empty: "No symptoms logged in this period.",
  });

  sections.push({
    title: "Symptom timeline",
    table: {
      columns: ["When", "Symptom", "Severity", "Body area", "Duration", "Triggers", "Note"],
      rows: [...symptoms].reverse().slice(0, 60).map((s) => [s.started_at, s.name, `${s.severity}/10`, s.body_area, s.duration, s.triggers, s.note]),
    },
    empty: "No symptoms logged in this period.",
  });

  // ---------- appointments ----------
  sections.push({
    title: "Appointments in this period",
    table: {
      columns: ["Date", "Doctor", "Specialty", "Reason", "Status", "Outcome / notes"],
      rows: apptsInPeriod.map((a) => [a.scheduled_at, a.doctor, a.specialty, a.reason, a.status, [a.outcome, a.notes].filter(Boolean).join(", ")]),
    },
    empty: "No appointments in this period.",
  });

  sections.push({
    title: "Upcoming appointments",
    table: {
      columns: ["Date", "Doctor", "Specialty", "Location", "Reason", "Questions to ask"],
      rows: upcoming.map((a) => {
        const f = fmtAppt(a, today);
        return [f.datetime, f.doctor, f.specialty, f.location, f.reason, f.questions.join("; ")];
      }),
    },
    empty: "No upcoming appointments in the next 90 days.",
  });

  // ---------- refills ----------
  sections.push({
    title: "Refills needed",
    table: {
      columns: ["Medication", "Units left", "Days of supply", "Refill at (days)", "Pharmacy", "Prescriber"],
      rows: refills.map((m) => [m.name, m.stock, daysOfSupply(m), m.refill_threshold_days, m.pharmacy, m.prescriber]),
      numeric: [1, 2, 3],
    },
    empty: "No refills needed right now.",
  });

  return {
    tool: TOOLS.health.name,
    title: "Health Report",
    subtitle: user.name ?? user.email,
    period: { from: range.from, to: range.to, label: range.label },
    kpis: [
      { label: "Adherence", value: adh.overall_percent === null ? "-" : `${adh.overall_percent}%`, detail: `${adh.scheduled} scheduled doses`, tone: adherenceTone(adh.overall_percent) },
      { label: "Doses taken", value: String(adh.taken), tone: "good" },
      { label: "Doses missed", value: String(missedCount), detail: adh.skipped ? `+${adh.skipped} skipped` : undefined, tone: missedCount ? "warn" : "neutral" },
      { label: "Symptoms logged", value: String(symptoms.length), detail: symSummary.length ? `${symSummary.length} different` : undefined },
      { label: "Flagged readings", value: String(flagged.length), detail: `${vitals.length} readings`, tone: flagged.length ? "warn" : "neutral" },
      { label: "Appointments", value: String(apptsInPeriod.filter((a) => a.status !== "cancelled").length), detail: `${upcoming.length} upcoming` },
    ],
    highlights,
    sections,
    disclaimer: DISCLAIMER,
  };
}

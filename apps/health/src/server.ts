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
  weekday,
  WEEKDAYS,
  zDate,
  zPeriodInput,
  zTime,
  type Units,
  type ToolContext,
  type ToolEnv,
  type Weekday,
} from "@quemo/core";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { buildReport } from "./report";

export type Env = ToolEnv;

export const FORMS = ["pill", "capsule", "liquid", "injection", "inhaler", "drops", "cream", "other"] as const;
export const DOSE_STATUSES = ["taken", "skipped", "missed"] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];
export type SlotStatus = DoseStatus | "due" | "overdue" | "upcoming";
export const VITAL_TYPES = [
  "blood_pressure",
  "heart_rate",
  "blood_glucose",
  "weight",
  "temperature",
  "spo2",
  "sleep_hours",
  "steps",
  "respiratory_rate",
  "other",
] as const;
export type VitalType = (typeof VITAL_TYPES)[number];
export const GLUCOSE_CONTEXTS = ["fasting", "before_meal", "after_meal", "bedtime", "random"] as const;
export const PARTS_OF_DAY = ["morning", "afternoon", "evening", "night"] as const;
export type PartOfDay = (typeof PARTS_OF_DAY)[number];

/** A scheduled slot counts as "due" from this many minutes before until this many minutes after its time. */
export const GRACE_MINUTES = 60;

export const DISCLAIMER = "Quemo is a tracking tool, not medical advice. Share this report with your healthcare provider.";

// ---------- local time helpers ----------

export interface LocalNow {
  date: string;
  time: string;
}

export const nowLocal = (tz: string, at: Date = new Date()): LocalNow => ({ date: localDate(tz, at), time: localTime(tz, at) });
export const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** Minutes on a time-zone-free axis for a local date + wall-clock time (for differences only). */
export const stamp = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`) / 60_000;
/** Normalizes 'YYYY-MM-DDTHH:MM' to the stored 'YYYY-MM-DD HH:MM'. */
export const normStamp = (s: string) => s.replace("T", " ");

const zDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}[T ]([01]\d|2[0-3]):[0-5]\d$/, "Use YYYY-MM-DD HH:MM (local time)");

/** Status of an unlogged slot today, relative to the current local time. */
export function slotStatus(slotTime: string, nowTime: string): "due" | "overdue" | "upcoming" {
  const diff = toMinutes(nowTime) - toMinutes(slotTime);
  if (diff > GRACE_MINUTES) return "overdue";
  if (diff < -GRACE_MINUTES) return "upcoming";
  return "due";
}

export function partOfDay(time: string): PartOfDay {
  if (time >= "04:00" && time < "12:00") return "morning";
  if (time >= "12:00" && time < "17:00") return "afternoon";
  if (time >= "17:00" && time < "22:00") return "evening";
  return "night";
}

// ---------- medications ----------

export interface MedRow {
  id: string;
  name: string;
  dosage: string | null;
  form: (typeof FORMS)[number];
  purpose: string | null;
  instructions: string | null;
  times: string;
  days: string | null;
  as_needed: number;
  start_date: string;
  end_date: string | null;
  prescriber: string | null;
  pharmacy: string | null;
  stock: number | null;
  units_per_dose: number;
  refill_threshold_days: number;
  active: number;
  stopped_at: string | null;
}

export const medTimes = (m: MedRow): string[] => JSON.parse(m.times);
export const medDays = (m: MedRow): Weekday[] | null => (m.days ? (m.days.split(",") as Weekday[]) : null);

/** Local times a medication is scheduled on `date` ([] when it isn't). */
export function slotsOn(m: MedRow, date: string): string[] {
  if (m.as_needed || date < m.start_date || (m.end_date && date > m.end_date)) return [];
  const stopDate = m.stopped_at?.slice(0, 10);
  if (stopDate && date > stopDate) return [];
  const days = medDays(m);
  if (days && !days.includes(WEEKDAYS[weekday(date)])) return [];
  const times = medTimes(m);
  return stopDate && date === stopDate ? times.filter((t) => t < m.stopped_at!.slice(11)) : times;
}

export function dosesPerDay(m: MedRow): number {
  if (m.as_needed) return 0;
  const days = medDays(m);
  return medTimes(m).length * (days ? days.length / 7 : 1);
}

/** Whole days the stock on hand lasts at the scheduled pace (null when stock isn't tracked or the med is as-needed). */
export function daysOfSupply(m: MedRow): number | null {
  if (m.stock === null) return null;
  const perDay = dosesPerDay(m) * m.units_per_dose;
  return perDay ? Math.floor(m.stock / perDay) : null;
}

export function refillNeeded(m: MedRow): boolean {
  if (m.stock === null || !m.active) return false;
  if (m.stock < m.units_per_dose) return true;
  const d = daysOfSupply(m);
  return d !== null && d <= m.refill_threshold_days;
}

export function scheduleText(m: MedRow): string {
  if (m.as_needed) return "as needed";
  const days = medDays(m);
  return `${medTimes(m).join(", ")} ${days ? days.join("/") : "daily"}`;
}

export function fmtMed(m: MedRow) {
  const supply = daysOfSupply(m);
  return {
    id: m.id,
    name: m.name,
    dosage: m.dosage,
    form: m.form,
    purpose: m.purpose,
    instructions: m.instructions,
    schedule: { as_needed: !!m.as_needed, times: medTimes(m), days: medDays(m) ?? "every day", text: scheduleText(m) },
    start_date: m.start_date,
    end_date: m.end_date,
    prescriber: m.prescriber,
    pharmacy: m.pharmacy,
    stock: m.stock,
    units_per_dose: m.units_per_dose,
    days_of_supply: supply,
    refill_threshold_days: m.refill_threshold_days,
    refill_needed: refillNeeded(m),
    active: !!m.active,
    stopped_at: m.stopped_at,
  };
}

export async function loadMeds(db: D1Database, uid: string, activeOnly: boolean): Promise<MedRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM medications WHERE user_id = ?1 AND (?2 = 0 OR active = 1) ORDER BY active DESC, name")
    .bind(uid, activeOnly ? 1 : 0)
    .all<MedRow>();
  return results;
}

// ---------- doses & slots ----------

export interface DoseRow {
  id: string;
  medication_id: string;
  medication: string;
  status: DoseStatus;
  scheduled_date: string;
  scheduled_time: string | null;
  actual_at: string;
  units: number;
  note: string | null;
}

export async function loadDoses(db: D1Database, uid: string, from: string, to: string): Promise<DoseRow[]> {
  const { results } = await db
    .prepare(
      `SELECT d.id, d.medication_id, m.name AS medication, d.status, d.scheduled_date, d.scheduled_time, d.actual_at, d.units, d.note
       FROM doses d JOIN medications m ON m.id = d.medication_id
       WHERE d.user_id = ?1 AND d.scheduled_date BETWEEN ?2 AND ?3 ORDER BY d.scheduled_date, d.scheduled_time, m.name`,
    )
    .bind(uid, from, to)
    .all<DoseRow>();
  return results;
}

export interface Slot {
  medication_id: string;
  medication: string;
  dosage: string | null;
  date: string;
  time: string;
  status: SlotStatus;
  logged: boolean;
  dose_id: string | null;
  actual_at: string | null;
  note: string | null;
}

/** Every scheduled slot between from and to with its status (logged status, or due/overdue/upcoming/missed when unlogged). */
export function buildSlots(meds: MedRow[], doses: DoseRow[], from: string, to: string, now: LocalNow): Slot[] {
  const byKey = new Map(doses.filter((d) => d.scheduled_time).map((d) => [`${d.medication_id}|${d.scheduled_date}|${d.scheduled_time}`, d]));
  const out: Slot[] = [];
  for (const m of meds) {
    const start = from > m.start_date ? from : m.start_date;
    for (let d = start; d <= to; d = addDays(d, 1)) {
      for (const t of slotsOn(m, d)) {
        const dose = byKey.get(`${m.id}|${d}|${t}`);
        const status: SlotStatus = dose ? dose.status : d < now.date ? "missed" : d > now.date ? "upcoming" : slotStatus(t, now.time);
        out.push({
          medication_id: m.id,
          medication: m.name,
          dosage: m.dosage,
          date: d,
          time: t,
          status,
          logged: !!dose,
          dose_id: dose?.id ?? null,
          actual_at: dose?.actual_at ?? null,
          note: dose?.note ?? null,
        });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.medication.localeCompare(b.medication));
}

export interface Adherence {
  medication: string;
  scheduled: number;
  taken: number;
  skipped: number;
  missed: number;
  percent: number | null;
}

/** Slots that count toward adherence: already logged, or scheduled before the current local time. */
export const countedSlots = (slots: Slot[], now: LocalNow) => slots.filter((s) => s.logged || s.date < now.date || (s.date === now.date && s.time < now.time));

/** Adherence = taken / scheduled slots (start/end/stop dates respected, future slots ignored). */
export function adherence(meds: MedRow[], slots: Slot[], now: LocalNow) {
  const counted = countedSlots(slots, now);
  const byMed: Adherence[] = meds
    .filter((m) => !m.as_needed)
    .map((m) => {
      const mine = counted.filter((s) => s.medication_id === m.id);
      const taken = mine.filter((s) => s.status === "taken").length;
      const skipped = mine.filter((s) => s.status === "skipped").length;
      return { medication: m.name, scheduled: mine.length, taken, skipped, missed: mine.length - taken - skipped, percent: mine.length ? Math.round((taken / mine.length) * 100) : null };
    })
    .filter((a) => a.scheduled > 0);
  const scheduled = byMed.reduce((s, a) => s + a.scheduled, 0);
  const taken = byMed.reduce((s, a) => s + a.taken, 0);
  const skipped = byMed.reduce((s, a) => s + a.skipped, 0);
  return { overall_percent: scheduled ? Math.round((taken / scheduled) * 100) : null, scheduled, taken, skipped, missed: scheduled - taken - skipped, by_medication: byMed };
}

/** Meds, doses, slots and adherence for a date range (slots never extend past today). */
export async function medicationData(db: D1Database, uid: string, from: string, to: string, now: LocalNow) {
  const meds = await loadMeds(db, uid, false);
  const end = to < now.date ? to : now.date;
  const doses = await loadDoses(db, uid, from, to);
  const slots = from <= end ? buildSlots(meds, doses, from, end, now) : [];
  return { meds, doses, slots, adherence: adherence(meds, slots, now), extra: doses.filter((d) => d.scheduled_time === null) };
}

/**
 * The slot a dose logged at `actual` most likely belongs to: the nearest unlogged slot that is already due
 * (within ±12h, at most GRACE_MINUTES early), else the nearest unlogged upcoming one. Null when none fits.
 */
export function pickSlot(
  m: MedRow,
  logged: Set<string>,
  actual: LocalNow,
  opts: { onlyDate?: string; dueOnly?: boolean } = {},
): { date: string; time: string } | null {
  const at = stamp(actual.date, actual.time);
  const dates = opts.onlyDate ? [opts.onlyDate] : [-1, 0, 1].map((o) => addDays(actual.date, o));
  const cands = dates
    .flatMap((d) => slotsOn(m, d).map((t) => ({ date: d, time: t, diff: stamp(d, t) - at })))
    .filter((c) => (opts.onlyDate || Math.abs(c.diff) <= 12 * 60) && !logged.has(`${c.date}|${c.time}`))
    .sort((a, b) => Math.abs(a.diff) - Math.abs(b.diff));
  const due = cands.find((c) => c.diff <= GRACE_MINUTES);
  if (due) return { date: due.date, time: due.time };
  if (opts.dueOnly) return null;
  return cands[0] ? { date: cands[0].date, time: cands[0].time } : null;
}

// ---------- vitals ----------

export interface VitalRow {
  id: string;
  type: VitalType;
  name: string | null;
  value: number;
  value2: number | null;
  unit: string;
  context: string | null;
  measured_at: string;
  note: string | null;
}

const VITAL_LABELS: Record<VitalType, string> = {
  blood_pressure: "Blood pressure",
  heart_rate: "Heart rate",
  blood_glucose: "Blood glucose",
  weight: "Weight",
  temperature: "Temperature",
  spo2: "SpO2",
  sleep_hours: "Sleep",
  steps: "Steps",
  respiratory_rate: "Respiratory rate",
  other: "Other",
};

export const vitalLabel = (v: Pick<VitalRow, "type" | "name">) => (v.type === "other" ? v.name ?? "Other" : VITAL_LABELS[v.type]);

export function defaultUnit(type: VitalType, units: Units): string {
  const imperial = units === "imperial";
  return {
    blood_pressure: "mmHg",
    heart_rate: "bpm",
    blood_glucose: "mg/dL",
    weight: imperial ? "lb" : "kg",
    temperature: imperial ? "°F" : "°C",
    spo2: "%",
    sleep_hours: "h",
    steps: "steps",
    respiratory_rate: "breaths/min",
    other: "",
  }[type];
}

export function normUnit(unit: string): string {
  const u = unit.trim();
  const l = u.toLowerCase().replace(/\s/g, "");
  const map: Record<string, string> = {
    c: "°C", "°c": "°C", celsius: "°C", f: "°F", "°f": "°F", fahrenheit: "°F",
    "mmol/l": "mmol/L", "mg/dl": "mg/dL", kg: "kg", kgs: "kg", lb: "lb", lbs: "lb", pounds: "lb",
    mmhg: "mmHg", bpm: "bpm", "%": "%", h: "h", hours: "h", hrs: "h",
  };
  return map[l] ?? u;
}

export const vitalValue = (v: Pick<VitalRow, "type" | "value" | "value2" | "unit">) =>
  `${v.type === "blood_pressure" ? `${v.value}/${v.value2}` : v.value}${v.unit ? ` ${v.unit}` : ""}`;

export interface VitalFlag {
  level: "attention" | "urgent";
  message: string;
}

/** Simple out-of-range check. Never a diagnosis: phrased as something to discuss with a professional. */
export function vitalFlag(v: VitalRow): VitalFlag | null {
  let reason: string | null = null;
  let urgent = false;
  switch (v.type) {
    case "blood_pressure": {
      const s = v.value;
      const d = v.value2 ?? 0;
      if (s >= 180 || d >= 120) [reason, urgent] = ["is very high (at or above 180/120)", true];
      else if (s >= 140 || d >= 90) reason = "is at or above 140/90";
      else if (s < 90 || d < 60) reason = "is below 90/60";
      break;
    }
    case "heart_rate":
      if (v.value > 100) reason = "is above 100 bpm";
      else if (v.value < 50) reason = "is below 50 bpm";
      break;
    case "blood_glucose": {
      const mg = v.unit === "mmol/L" ? v.value * 18 : v.value;
      if (mg < 54) [reason, urgent] = ["is very low", true];
      else if (mg < 70) reason = "is low (below 70 mg/dL / 3.9 mmol/L)";
      else if (mg >= 300) [reason, urgent] = ["is very high", true];
      else if (mg >= 200) reason = "is high (200 mg/dL / 11.1 mmol/L or more)";
      else if (v.context === "fasting" && mg >= 126) reason = "is high for a fasting reading (126 mg/dL / 7.0 mmol/L or more)";
      break;
    }
    case "temperature": {
      const c = v.unit === "°F" ? ((v.value - 32) * 5) / 9 : v.value;
      if (c >= 40) [reason, urgent] = ["is a high fever (40 °C / 104 °F or more)", true];
      else if (c >= 38) reason = "is a fever (38 °C / 100.4 °F or more)";
      else if (c < 35) reason = "is below 35 °C / 95 °F";
      break;
    }
    case "spo2":
      if (v.value < 90) [reason, urgent] = ["is below 90%", true];
      else if (v.value < 94) reason = "is below 94%";
      break;
    case "respiratory_rate":
      if (v.value > 20) reason = "is above 20 breaths/min";
      else if (v.value < 12) reason = "is below 12 breaths/min";
      break;
    default:
      break;
  }
  if (!reason) return null;
  const what = `${vitalLabel(v)} ${vitalValue(v)} on ${v.measured_at}`;
  return urgent
    ? { level: "urgent", message: `${what} ${reason} — consider contacting a healthcare professional promptly.` }
    : { level: "attention", message: `${what} ${reason} — worth discussing with your doctor.` };
}

export function trendOf(values: number[], tolerance = 0.03): "rising" | "falling" | "stable" | "not enough data" {
  if (values.length < 2) return "not enough data";
  const half = Math.floor(values.length / 2);
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const a = mean(values.slice(0, half));
  const b = mean(values.slice(values.length - half));
  const change = a === 0 ? (b === 0 ? 0 : 1) : (b - a) / Math.abs(a);
  return Math.abs(change) < tolerance ? "stable" : change > 0 ? "rising" : "falling";
}

export interface VitalStat {
  type: VitalType;
  measurement: string;
  unit: string;
  count: number;
  avg: number | string;
  min: number | string;
  max: number | string;
  latest: number | string;
  latest_at: string;
  trend: string;
  flagged: number;
}

/** Stats per measurement (type + custom name + unit) from readings in chronological order. */
export function vitalStats(rows: VitalRow[]): VitalStat[] {
  const groups = new Map<string, VitalRow[]>();
  for (const r of [...rows].sort((a, b) => a.measured_at.localeCompare(b.measured_at))) {
    const key = `${r.type}|${(r.name ?? "").toLowerCase()}|${r.unit}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()].map((g) => {
    const bp = g[0].type === "blood_pressure";
    const v1 = g.map((r) => r.value);
    const v2 = g.map((r) => r.value2 ?? 0);
    const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const last = g[g.length - 1];
    const fmt = (a: number, b: number) => (bp ? `${Math.round(a)}/${Math.round(b)}` : round(a, 1));
    return {
      type: g[0].type,
      measurement: vitalLabel(g[0]),
      unit: g[0].unit,
      count: g.length,
      avg: fmt(mean(v1), mean(v2)),
      min: fmt(Math.min(...v1), Math.min(...v2)),
      max: fmt(Math.max(...v1), Math.max(...v2)),
      latest: fmt(last.value, last.value2 ?? 0),
      latest_at: last.measured_at,
      trend: trendOf(v1),
      flagged: g.filter((r) => vitalFlag(r)).length,
    };
  });
}

export async function loadVitals(db: D1Database, uid: string, from: string, to: string, type?: VitalType | null, name?: string | null): Promise<VitalRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, type, name, value, value2, unit, context, measured_at, note FROM vitals
       WHERE user_id = ?1 AND measured_at BETWEEN ?2 AND ?3 || ' 23:59' AND (?4 IS NULL OR type = ?4) AND (?5 IS NULL OR name = ?5 COLLATE NOCASE)
       ORDER BY measured_at`,
    )
    .bind(uid, from, to, type ?? null, name ?? null)
    .all<VitalRow>();
  return results;
}

// ---------- symptoms ----------

export interface SymptomRow {
  id: string;
  name: string;
  severity: number;
  body_area: string | null;
  started_at: string;
  duration: string | null;
  triggers: string | null;
  note: string | null;
}

export async function loadSymptoms(db: D1Database, uid: string, from: string, to: string, name?: string | null): Promise<SymptomRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, severity, body_area, started_at, duration, triggers, note FROM symptoms
       WHERE user_id = ?1 AND started_at BETWEEN ?2 AND ?3 || ' 23:59' AND (?4 IS NULL OR name = ?4) ORDER BY started_at`,
    )
    .bind(uid, from, to, name ?? null)
    .all<SymptomRow>();
  return results;
}

/** Frequency and severity per symptom (rows in chronological order). */
export function symptomSummary(rows: SymptomRow[]) {
  const groups = new Map<string, SymptomRow[]>();
  for (const r of [...rows].sort((a, b) => a.started_at.localeCompare(b.started_at))) {
    const key = r.name.toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.values()]
    .map((g) => {
      const sev = g.map((r) => r.severity);
      const half = Math.floor(g.length / 2);
      const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
      const delta = g.length >= 2 ? mean(sev.slice(g.length - half)) - mean(sev.slice(0, half)) : 0;
      return {
        symptom: g[0].name,
        count: g.length,
        days: new Set(g.map((r) => r.started_at.slice(0, 10))).size,
        avg_severity: round(mean(sev), 1),
        max_severity: Math.max(...sev),
        first: g[0].started_at,
        last: g[g.length - 1].started_at,
        body_areas: [...new Set(g.map((r) => r.body_area).filter(Boolean))] as string[],
        trend: g.length < 2 ? "single entry" : delta >= 1 ? "worsening" : delta <= -1 ? "improving" : "stable",
      };
    })
    .sort((a, b) => b.count - a.count || b.avg_severity - a.avg_severity);
}

// ---------- appointments & profile ----------

export interface ApptRow {
  id: string;
  doctor: string;
  specialty: string | null;
  scheduled_at: string;
  location: string | null;
  reason: string | null;
  questions: string;
  notes: string | null;
  outcome: string | null;
  status: "scheduled" | "completed" | "cancelled";
}

export function fmtAppt(a: ApptRow, today: string) {
  return {
    id: a.id,
    doctor: a.doctor,
    specialty: a.specialty,
    datetime: a.scheduled_at,
    days_until: daysBetween(today, a.scheduled_at.slice(0, 10)),
    location: a.location,
    reason: a.reason,
    questions: JSON.parse(a.questions) as string[],
    notes: a.notes,
    outcome: a.outcome,
    status: a.status,
  };
}

export async function loadAppointments(db: D1Database, uid: string, from: string, to: string, includeCancelled = true): Promise<ApptRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, doctor, specialty, scheduled_at, location, reason, questions, notes, outcome, status FROM appointments
       WHERE user_id = ?1 AND scheduled_at BETWEEN ?2 AND ?3 AND (?4 = 1 OR status != 'cancelled') ORDER BY scheduled_at`,
    )
    .bind(uid, from, to, includeCancelled ? 1 : 0)
    .all<ApptRow>();
  return results;
}

export interface HealthProfile {
  conditions: string[];
  allergies: string[];
  blood_type: string | null;
  emergency_contact: string | null;
  primary_doctor: string | null;
  notes: string | null;
  exists: boolean;
}

export async function loadProfile(db: D1Database, uid: string): Promise<HealthProfile> {
  const row = await db
    .prepare("SELECT conditions, allergies, blood_type, emergency_contact, primary_doctor, notes FROM health_profile WHERE user_id = ?")
    .bind(uid)
    .first<{ conditions: string; allergies: string; blood_type: string | null; emergency_contact: string | null; primary_doctor: string | null; notes: string | null }>();
  if (!row) return { conditions: [], allergies: [], blood_type: null, emergency_contact: null, primary_doctor: null, notes: null, exists: false };
  return { ...row, conditions: JSON.parse(row.conditions), allergies: JSON.parse(row.allergies), exists: true };
}

const uniq = (list: string[]) => {
  const seen = new Set<string>();
  return list.map((s) => s.trim()).filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
};

// ---------- the MCP server ----------

const text = (max: number) => z.string().trim().min(1).max(max);
const medRef = z.string().trim().min(1).max(80).describe("Medication name (case-insensitive) or id");

export function buildServer(ctx: ToolContext<Env>): McpServer {
  const { env, user } = ctx;
  const db = env.DB;
  const uid = user.id;
  const now = () => nowLocal(user.timezone);
  const today = () => localDate(user.timezone);

  const server = createToolServer(ctx, {
    name: "quemo-health",
    instructions:
      "Quemo Health: medication & health follow-up tracker. Medication schedules are local wall-clock times (HH:MM) in the user's time zone. " +
      "Add medicines with add_medication (schedule times + optional weekdays, or as_needed; stock and units_per_dose enable refill alerts). " +
      "When the user says they took their pills ('took my meds', 'took all my morning meds') call log_doses — with part_of_day for 'morning/evening…' — so each medication's due slot is marked; " +
      "for a single medicine use log_dose (it picks the nearest due slot). Taking a dose lowers the stock; refill_medication adds stock. " +
      "todays_doses shows today's schedule; log_vital records blood pressure, glucose, weight, temperature, SpO2 and more; log_symptom records how they feel; " +
      "appointments go in add_appointment (keep questions_to_ask there) and complete_appointment afterwards. " +
      "Never diagnose or change treatment: report numbers neutrally, and when a reading is flagged suggest discussing it with their doctor, or contacting a healthcare professional promptly for urgent flags. " +
      "Do not advise starting, stopping or changing doses — that is for their prescriber.",
  });

  async function findMed(ref: string): Promise<MedRow | null> {
    const r = ref.trim();
    const exact = await db.prepare("SELECT * FROM medications WHERE user_id = ?1 AND (id = ?2 OR name = ?2)").bind(uid, r).first<MedRow>();
    if (exact) return exact;
    const { results } = await db
      .prepare("SELECT * FROM medications WHERE user_id = ?1 AND name LIKE ?2 || '%' ORDER BY active DESC LIMIT 2")
      .bind(uid, r.replace(/[%_]/g, ""))
      .all<MedRow>();
    return results.length === 1 ? results[0] : null;
  }
  const getMed = (medId: string) => db.prepare("SELECT * FROM medications WHERE id = ? AND user_id = ?").bind(medId, uid).first<MedRow>();

  async function loggedSlots(medId: string, from: string, to: string): Promise<Set<string>> {
    const { results } = await db
      .prepare("SELECT scheduled_date, scheduled_time FROM doses WHERE medication_id = ? AND scheduled_date BETWEEN ? AND ? AND scheduled_time IS NOT NULL")
      .bind(medId, from, to)
      .all<{ scheduled_date: string; scheduled_time: string }>();
    return new Set(results.map((r) => `${r.scheduled_date}|${r.scheduled_time}`));
  }

  /** Inserts or updates the dose for a slot and keeps the stock in sync (only 'taken' consumes units). */
  async function recordDose(m: MedRow, status: DoseStatus, date: string, time: string | null, actualAt: string, note?: string) {
    const existing = time
      ? await db
          .prepare("SELECT id, units FROM doses WHERE medication_id = ? AND scheduled_date = ? AND scheduled_time = ?")
          .bind(m.id, date, time)
          .first<{ id: string; units: number }>()
      : null;
    const units = status === "taken" ? m.units_per_dose : 0;
    const restock = (existing?.units ?? 0) - units;
    const doseId = existing?.id ?? id();
    const stmts = [
      existing
        ? db.prepare("UPDATE doses SET status = ?, actual_at = ?, units = ?, note = COALESCE(?, note) WHERE id = ?").bind(status, actualAt, units, note ?? null, doseId)
        : db
            .prepare(
              `INSERT INTO doses (id, user_id, medication_id, status, scheduled_date, scheduled_time, actual_at, units, note, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
            )
            .bind(doseId, uid, m.id, status, date, time, actualAt, units, note ?? null, Date.now()),
    ];
    if (m.stock !== null && restock !== 0) stmts.push(db.prepare("UPDATE medications SET stock = MAX(0, stock + ?) WHERE id = ?").bind(restock, m.id));
    await db.batch(stmts);
    const after = (await getMed(m.id))!;
    return {
      dose: { id: doseId, medication: m.name, dosage: m.dosage, status, scheduled_date: date, scheduled_time: time, actual_at: actualAt, note: note ?? null, updated_existing: !!existing },
      med: after,
    };
  }

  const stockNote = (m: MedRow) => {
    if (m.stock === null) return "";
    const d = daysOfSupply(m);
    return ` ${m.stock} left${d !== null ? ` (~${d} days)` : ""}${refillNeeded(m) ? " — time to refill" : ""}.`;
  };

  // ---------- medications ----------

  const schedule = {
    times: z.array(zTime).max(12).optional().describe("Local wall-clock times, e.g. ['08:00', '20:00']"),
    days: z.array(z.enum(WEEKDAYS)).max(7).optional().describe("Weekdays it is taken (sun..sat). Omit for every day."),
    as_needed: z.boolean().optional().describe("Taken only when needed (no schedule, never counted as missed)"),
  };
  const medFields = {
    dosage: z.string().trim().max(60).optional().describe("Strength per dose, e.g. '500 mg', '2 puffs'"),
    form: z.enum(FORMS).optional(),
    purpose: z.string().trim().max(200).optional().describe("Condition / why it is taken"),
    instructions: z.string().trim().max(300).optional().describe("e.g. 'with food', 'before bed'"),
    ...schedule,
    start_date: zDate.optional().describe("First day of the schedule (defaults to today)"),
    end_date: zDate.optional().describe("Last day of a course (e.g. antibiotics)"),
    prescriber: z.string().trim().max(120).optional(),
    pharmacy: z.string().trim().max(120).optional(),
    stock: z.number().min(0).max(100000).optional().describe("Units on hand (pills, ml, puffs…)"),
    units_per_dose: z.number().positive().max(1000).optional().describe("Units used per dose (default 1)"),
    refill_threshold_days: z.number().int().min(0).max(180).optional().describe("Warn when supply drops to this many days (default 7)"),
  };

  const normTimes = (times?: string[]) => JSON.stringify([...new Set(times ?? [])].sort());
  const normDays = (days?: Weekday[]) => (!days?.length || new Set(days).size === 7 ? null : WEEKDAYS.filter((d) => days.includes(d)).join(","));

  server.registerTool(
    "add_medication",
    {
      title: "Add medication",
      description: "Start tracking a medication or supplement: dosage, form, purpose, schedule (local times + weekdays, or as-needed), course dates, prescriber, pharmacy and stock.",
      inputSchema: z.object({ name: text(80), ...medFields }),
    },
    async (a) => {
      const asNeeded = a.as_needed ?? false;
      if (!asNeeded && !a.times?.length) return fail("Give the schedule times (HH:MM, e.g. ['08:00']) or set as_needed=true.");
      const start = a.start_date ?? today();
      if (a.end_date && a.end_date < start) return fail("end_date is before start_date.");
      if (await db.prepare("SELECT 1 FROM medications WHERE user_id = ? AND name = ?").bind(uid, a.name).first())
        return fail(`${a.name} is already tracked — use update_medication to change it.`);
      const medId = id();
      await db
        .prepare(
          `INSERT INTO medications (id, user_id, name, dosage, form, purpose, instructions, times, days, as_needed, start_date, end_date, prescriber, pharmacy, stock, units_per_dose, refill_threshold_days, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
        )
        .bind(
          medId,
          uid,
          a.name,
          a.dosage ?? null,
          a.form ?? "pill",
          a.purpose ?? null,
          a.instructions ?? null,
          asNeeded ? "[]" : normTimes(a.times),
          asNeeded ? null : normDays(a.days),
          asNeeded ? 1 : 0,
          start,
          a.end_date ?? null,
          a.prescriber ?? null,
          a.pharmacy ?? null,
          a.stock ?? null,
          a.units_per_dose ?? 1,
          a.refill_threshold_days ?? 7,
          Date.now(),
        )
        .run();
      const m = (await getMed(medId))!;
      return ok(fmtMed(m), `Tracking ${m.name}${m.dosage ? ` ${m.dosage}` : ""}: ${scheduleText(m)}.${stockNote(m)}`);
    },
  );

  server.registerTool(
    "update_medication",
    {
      title: "Update medication",
      description: "Change any field of a medication (rename, dosage, schedule, course dates, stock…). active=true resumes a stopped medication.",
      inputSchema: z.object({ medication: medRef, name: text(80).optional(), ...medFields, active: z.boolean().optional() }),
    },
    async (a) => {
      const m = await findMed(a.medication);
      if (!m) return fail(`Medication ${a.medication} not found`);
      const asNeeded = a.as_needed ?? !!m.as_needed;
      const times = a.times ? normTimes(a.times) : m.times;
      if (!asNeeded && times === "[]") return fail("A scheduled medication needs at least one time (or set as_needed=true).");
      const start = a.start_date ?? m.start_date;
      const end = a.end_date ?? m.end_date;
      if (end && end < start) return fail("end_date is before start_date.");
      if (a.name && a.name.toLowerCase() !== m.name.toLowerCase() && (await db.prepare("SELECT 1 FROM medications WHERE user_id = ? AND name = ?").bind(uid, a.name).first()))
        return fail(`Another medication is already named ${a.name}.`);
      const resume = a.active === true && !m.active;
      const stop = a.active === false && !!m.active;
      const n = now();
      await db
        .prepare(
          `UPDATE medications SET name = ?1, dosage = ?2, form = ?3, purpose = ?4, instructions = ?5, times = ?6, days = ?7, as_needed = ?8, start_date = ?9, end_date = ?10,
             prescriber = ?11, pharmacy = ?12, stock = ?13, units_per_dose = ?14, refill_threshold_days = ?15, active = ?16, stopped_at = ?17
           WHERE id = ?18 AND user_id = ?19`,
        )
        .bind(
          a.name ?? m.name,
          a.dosage ?? m.dosage,
          a.form ?? m.form,
          a.purpose ?? m.purpose,
          a.instructions ?? m.instructions,
          asNeeded ? "[]" : times,
          asNeeded ? null : a.days ? normDays(a.days) : m.days,
          asNeeded ? 1 : 0,
          start,
          end,
          a.prescriber ?? m.prescriber,
          a.pharmacy ?? m.pharmacy,
          a.stock ?? m.stock,
          a.units_per_dose ?? m.units_per_dose,
          a.refill_threshold_days ?? m.refill_threshold_days,
          stop ? 0 : resume ? 1 : m.active,
          stop ? `${n.date} ${n.time}` : resume ? null : m.stopped_at,
          m.id,
          uid,
        )
        .run();
      const after = (await getMed(m.id))!;
      return ok(fmtMed(after), `${after.name} updated: ${scheduleText(after)}.${stockNote(after)}`);
    },
  );

  server.registerTool(
    "list_medications",
    {
      title: "List medications",
      description: "Current medications with schedule, purpose, stock and days of supply remaining. include_stopped adds stopped ones.",
      inputSchema: z.object({ include_stopped: z.boolean().default(false) }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const meds = await loadMeds(db, uid, !a.include_stopped);
      return ok({ count: meds.length, medications: meds.map(fmtMed) });
    },
  );

  server.registerTool(
    "stop_medication",
    {
      title: "Stop medication",
      description: "Mark a medication as no longer taken (keeps its history; no more doses are scheduled after now).",
      inputSchema: z.object({ medication: medRef }),
    },
    async (a) => {
      const m = await findMed(a.medication);
      if (!m) return fail(`Medication ${a.medication} not found`);
      if (!m.active) return fail(`${m.name} is already stopped.`);
      const n = now();
      await db.prepare("UPDATE medications SET active = 0, stopped_at = ? WHERE id = ? AND user_id = ?").bind(`${n.date} ${n.time}`, m.id, uid).run();
      return ok(fmtMed((await getMed(m.id))!), `${m.name} stopped. Its history stays in your reports.`);
    },
  );

  server.registerTool(
    "delete_medication",
    {
      title: "Delete medication",
      description: "Permanently delete a medication and all its logged doses (use stop_medication to keep history).",
      inputSchema: z.object({ medication: medRef }),
      annotations: { destructiveHint: true },
    },
    async (a) => {
      const m = await findMed(a.medication);
      if (!m) return fail(`Medication ${a.medication} not found`);
      await db.batch([
        db.prepare("DELETE FROM doses WHERE medication_id = ? AND user_id = ?").bind(m.id, uid),
        db.prepare("DELETE FROM medications WHERE id = ? AND user_id = ?").bind(m.id, uid),
      ]);
      return ok({ deleted: m.name }, `${m.name} and its dose history deleted.`);
    },
  );

  server.registerTool(
    "refill_medication",
    {
      title: "Refill medication",
      description: "Add units to a medication's stock after picking up a refill (or set the exact count with set_stock).",
      inputSchema: z.object({
        medication: medRef,
        quantity: z.number().positive().max(100000).optional().describe("Units added"),
        set_stock: z.number().min(0).max(100000).optional().describe("Exact units on hand instead"),
      }),
    },
    async (a) => {
      if (a.quantity === undefined && a.set_stock === undefined) return fail("Give quantity (units added) or set_stock.");
      const m = await findMed(a.medication);
      if (!m) return fail(`Medication ${a.medication} not found`);
      await db
        .prepare("UPDATE medications SET stock = CASE WHEN ?1 IS NOT NULL THEN ?1 ELSE COALESCE(stock, 0) + ?2 END WHERE id = ?3 AND user_id = ?4")
        .bind(a.set_stock ?? null, a.quantity ?? 0, m.id, uid)
        .run();
      const after = (await getMed(m.id))!;
      return ok(fmtMed(after), `${after.name} restocked:${stockNote(after)}`);
    },
  );

  // ---------- doses ----------

  server.registerTool(
    "log_dose",
    {
      title: "Log dose",
      description:
        "Record one dose of a medication as taken, skipped or missed. Without scheduled_time it is matched to the nearest due slot; as-needed medicines are logged as unscheduled doses. Taking a dose lowers the stock.",
      inputSchema: z.object({
        medication: medRef,
        status: z.enum(DOSE_STATUSES).default("taken"),
        scheduled_time: zTime.optional().describe("The schedule slot this dose is for, e.g. '08:00'"),
        date: zDate.optional().describe("Date of the slot (defaults to the date it was taken)"),
        taken_at: zDateTime.optional().describe("When it was actually taken, local 'YYYY-MM-DD HH:MM' (default now)"),
        note: z.string().trim().max(300).optional(),
      }),
    },
    async (a) => {
      const m = await findMed(a.medication);
      if (!m) return fail(`Medication ${a.medication} not found`);
      if (!m.active) return fail(`${m.name} is stopped — resume it with update_medication (active=true) first.`);
      const n = now();
      const actualStr = a.taken_at
        ? normStamp(a.taken_at)
        : a.scheduled_time && a.date && a.date < n.date
          ? `${a.date} ${a.scheduled_time}`
          : `${n.date} ${n.time}`;
      const actual = { date: actualStr.slice(0, 10), time: actualStr.slice(11) };
      if (stamp(actual.date, actual.time) > stamp(n.date, n.time) + 5) return fail("That time is in the future — log doses once they've happened.");

      let slot: { date: string; time: string } | null = null;
      if (!m.as_needed) {
        if (a.scheduled_time) {
          const date = a.date ?? actual.date;
          const times = slotsOn(m, date);
          if (!times.includes(a.scheduled_time))
            return fail(`${m.name} isn't scheduled at ${a.scheduled_time} on ${date} (${times.length ? `slots: ${times.join(", ")}` : "no doses that day"}).`);
          slot = { date, time: a.scheduled_time };
        } else {
          const base = a.date ?? actual.date;
          slot = pickSlot(m, await loggedSlots(m.id, addDays(base, -1), addDays(base, 1)), actual, { onlyDate: a.date });
        }
      }
      const { dose, med } = await recordDose(m, a.status, slot?.date ?? a.date ?? actual.date, slot?.time ?? null, actualStr, a.note);
      const what = slot ? `${slot.time} dose${slot.date !== n.date ? ` of ${slot.date}` : ""}` : m.as_needed ? "as-needed dose" : "extra dose (no open scheduled slot)";
      return ok({ ...dose, stock: med.stock, days_of_supply: daysOfSupply(med), refill_needed: refillNeeded(med) }, `${m.name} ${what}: ${a.status}.${stockNote(med)}`);
    },
  );

  server.registerTool(
    "log_doses",
    {
      title: "Log several doses",
      description:
        "Bulk-log doses, e.g. 'took all my morning meds' (part_of_day=morning) or 'took my pills' (every medication's currently due slot). Optionally limit to named medications.",
      inputSchema: z.object({
        medications: z.array(medRef).max(30).optional().describe("Only these medications (default: every active scheduled medication)"),
        part_of_day: z.enum(PARTS_OF_DAY).optional().describe("morning 04–12, afternoon 12–17, evening 17–22, night 22–04"),
        status: z.enum(DOSE_STATUSES).default("taken"),
        date: zDate.optional().describe("Day of the slots (default today)"),
        taken_at: zDateTime.optional().describe("When they were taken, local 'YYYY-MM-DD HH:MM' (default now)"),
        note: z.string().trim().max(300).optional(),
      }),
    },
    async (a) => {
      const n = now();
      const date = a.date ?? n.date;
      if (date > n.date) return fail("That date is in the future.");
      let meds: MedRow[];
      if (a.medications?.length) {
        meds = [];
        for (const ref of a.medications) {
          const m = await findMed(ref);
          if (!m) return fail(`Medication ${ref} not found`);
          if (!m.active) return fail(`${m.name} is stopped.`);
          meds.push(m);
        }
      } else meds = (await loadMeds(db, uid, true)).filter((m) => !m.as_needed);

      const logged: { medication: string; date: string; time: string | null; status: DoseStatus }[] = [];
      const skipped: { medication: string; reason: string }[] = [];
      for (const m of meds) {
        const taken = await loggedSlots(m.id, addDays(date, -1), addDays(date, 1));
        let slots: { date: string; time: string | null }[] = [];
        if (m.as_needed) slots = [{ date, time: null }];
        else if (a.part_of_day) slots = slotsOn(m, date).filter((t) => partOfDay(t) === a.part_of_day && !taken.has(`${date}|${t}`)).map((t) => ({ date, time: t }));
        else {
          const actual = a.taken_at ? { date: normStamp(a.taken_at).slice(0, 10), time: normStamp(a.taken_at).slice(11) } : date === n.date ? n : { date, time: "23:59" };
          const s = pickSlot(m, taken, actual, { onlyDate: a.date, dueOnly: !a.medications?.length });
          if (s) slots = [s];
        }
        if (!slots.length) {
          skipped.push({ medication: m.name, reason: a.part_of_day ? `nothing open in the ${a.part_of_day}` : "no dose due right now" });
          continue;
        }
        for (const s of slots) {
          const actualAt = a.taken_at ? normStamp(a.taken_at) : s.date < n.date && s.time ? `${s.date} ${s.time}` : `${n.date} ${n.time}`;
          await recordDose(m, a.status, s.date, s.time, actualAt, a.note);
          logged.push({ medication: m.name, date: s.date, time: s.time, status: a.status });
        }
      }
      if (!logged.length) return fail(`Nothing to log: ${skipped.map((s) => `${s.medication} (${s.reason})`).join(", ") || "no active scheduled medications"}.`);
      return ok(
        { logged, skipped },
        `Logged ${logged.length} dose${logged.length === 1 ? "" : "s"} as ${a.status}: ${logged.map((l) => `${l.medication}${l.time ? ` ${l.time}` : ""}`).join(", ")}.`,
      );
    },
  );

  server.registerTool(
    "todays_doses",
    {
      title: "Today's doses",
      description: "Schedule view: every dose slot of the day with its status (taken / skipped / missed / due / overdue / upcoming) plus as-needed doses taken.",
      inputSchema: z.object({ date: zDate.optional().describe("Defaults to today") }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const n = now();
      const date = a.date ?? n.date;
      const meds = await loadMeds(db, uid, false);
      const doses = await loadDoses(db, uid, date, date);
      const slots = buildSlots(meds, doses, date, date, n);
      const count = (s: SlotStatus) => slots.filter((x) => x.status === s).length;
      const taken = count("taken");
      const dueNow = slots.filter((s) => s.status === "due" || s.status === "overdue");
      return ok(
        {
          date,
          now: n.time,
          total: slots.length,
          taken,
          due: count("due"),
          overdue: count("overdue"),
          upcoming: count("upcoming"),
          slots: slots.map((s) => ({ medication: s.medication, dosage: s.dosage, time: s.time, status: s.status, dose_id: s.dose_id, taken_at: s.actual_at, note: s.note })),
          as_needed: doses.filter((d) => d.scheduled_time === null).map((d) => ({ medication: d.medication, status: d.status, at: d.actual_at, dose_id: d.id })),
        },
        slots.length
          ? `${taken} of ${slots.length} doses taken${date === n.date ? " today" : ` on ${date}`}.${dueNow.length ? ` Due now: ${dueNow.map((s) => `${s.medication} ${s.time}${s.status === "overdue" ? " (overdue)" : ""}`).join(", ")}.` : ""}`
          : `No scheduled doses ${date === n.date ? "today" : `on ${date}`}.`,
      );
    },
  );

  server.registerTool(
    "dose_history",
    {
      title: "Dose history",
      description: "Logged doses (taken, skipped, missed, as-needed) over a period, newest first, optionally for one medication.",
      inputSchema: z.object({
        ...zPeriodInput,
        period: z.enum(PERIODS).default("last_7_days").describe("Named period in the user's time zone; use 'custom' with from/to"),
        medication: medRef.optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      let medId: string | null = null;
      if (a.medication) {
        const m = await findMed(a.medication);
        if (!m) return fail(`Medication ${a.medication} not found`);
        medId = m.id;
      }
      const doses = (await loadDoses(db, uid, r.from, r.to)).filter((d) => !medId || d.medication_id === medId).reverse().slice(0, a.limit);
      return ok({
        period: r,
        count: doses.length,
        doses: doses.map((d) => ({ id: d.id, medication: d.medication, status: d.status, slot: d.scheduled_time ? `${d.scheduled_date} ${d.scheduled_time}` : null, date: d.scheduled_date, at: d.actual_at, note: d.note })),
      });
    },
  );

  server.registerTool(
    "delete_dose",
    {
      title: "Delete dose",
      description: "Undo a logged dose (id from todays_doses / dose_history); a taken dose's units go back into stock.",
      inputSchema: z.object({ id: z.string() }),
      annotations: { destructiveHint: true },
    },
    async (a) => {
      const d = await db.prepare("SELECT id, medication_id, units FROM doses WHERE id = ? AND user_id = ?").bind(a.id, uid).first<{ id: string; medication_id: string; units: number }>();
      if (!d) return fail(`Dose ${a.id} not found`);
      await db.batch([
        db.prepare("DELETE FROM doses WHERE id = ?").bind(d.id),
        db.prepare("UPDATE medications SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL").bind(d.units, d.medication_id),
      ]);
      return ok({ deleted: a.id }, "Dose removed.");
    },
  );

  server.registerTool(
    "medication_adherence",
    {
      title: "Medication adherence",
      description: "Adherence per medication over a period: doses taken / scheduled slots (respecting start, end and stop dates; future slots not counted; as-needed medicines excluded), plus missed slots.",
      inputSchema: z.object({ ...zPeriodInput, period: z.enum(PERIODS).default("last_30_days").describe("Named period in the user's time zone; use 'custom' with from/to") }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      const n = now();
      const data = await medicationData(db, uid, r.from, r.to, n);
      const missed = countedSlots(data.slots, n).filter((s) => s.status !== "taken");
      return ok(
        {
          period: r,
          ...data.adherence,
          not_taken: missed.map((s) => ({ medication: s.medication, date: s.date, time: s.time, status: s.logged ? s.status : "not logged" })),
          as_needed_doses: data.extra.filter((d) => d.status === "taken").length,
        },
        data.adherence.overall_percent === null ? "No scheduled doses in this period." : `Adherence ${r.label.toLowerCase()}: ${data.adherence.overall_percent}% (${data.adherence.taken}/${data.adherence.scheduled} doses).`,
      );
    },
  );

  // ---------- vitals ----------

  server.registerTool(
    "log_vital",
    {
      title: "Log vital / measurement",
      description:
        "Record a measurement: blood_pressure (systolic + diastolic), heart_rate, blood_glucose (+context), weight, temperature, spo2, sleep_hours, steps, respiratory_rate, or other (with name + unit). Out-of-range values are flagged.",
      inputSchema: z.object({
        type: z.enum(VITAL_TYPES),
        value: z.number().min(0).max(1_000_000).optional().describe("The reading (not used for blood_pressure)"),
        systolic: z.number().int().min(40).max(300).optional(),
        diastolic: z.number().int().min(20).max(200).optional(),
        unit: z.string().trim().min(1).max(20).optional().describe("Defaults by type and the user's units (kg/lb, °C/°F, mg/dL…)"),
        name: z.string().trim().min(1).max(60).optional().describe("Measurement name for type 'other' (e.g. 'Peak flow')"),
        context: z.enum(GLUCOSE_CONTEXTS).optional().describe("Blood glucose only"),
        measured_at: zDateTime.optional().describe("Local 'YYYY-MM-DD HH:MM' (default now)"),
        note: z.string().trim().max(300).optional(),
      }),
    },
    async (a) => {
      let value: number;
      let value2: number | null = null;
      if (a.type === "blood_pressure") {
        if (a.systolic === undefined || a.diastolic === undefined) return fail("Blood pressure needs systolic and diastolic (e.g. 120 and 80).");
        if (a.systolic <= a.diastolic) return fail("Systolic (top number) must be higher than diastolic.");
        [value, value2] = [a.systolic, a.diastolic];
      } else {
        if (a.value === undefined) return fail(`Give the ${a.type.replace(/_/g, " ")} value.`);
        value = a.value;
      }
      if (a.type === "other" && !a.name) return fail("Give a name for an 'other' measurement (e.g. 'Peak flow').");
      if (a.type === "spo2" && value > 100) return fail("SpO2 is a percentage (0–100).");
      if (a.type === "sleep_hours" && value > 24) return fail("Sleep hours must be 24 or less.");
      const unit = a.unit ? normUnit(a.unit) : defaultUnit(a.type, user.units);
      const n = now();
      const at = a.measured_at ? normStamp(a.measured_at) : `${n.date} ${n.time}`;
      if (at > `${n.date} ${n.time}` && stamp(at.slice(0, 10), at.slice(11)) > stamp(n.date, n.time) + 5) return fail("measured_at is in the future.");
      const vid = id();
      const row: VitalRow = {
        id: vid,
        type: a.type,
        name: a.type === "other" ? a.name! : null,
        value,
        value2,
        unit,
        context: a.type === "blood_glucose" ? a.context ?? null : null,
        measured_at: at,
        note: a.note ?? null,
      };
      await db
        .prepare("INSERT INTO vitals (id, user_id, type, name, value, value2, unit, context, measured_at, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
        .bind(vid, uid, row.type, row.name, row.value, row.value2, row.unit, row.context, row.measured_at, row.note, Date.now())
        .run();
      const flag = vitalFlag(row);
      return ok(
        { ...row, measurement: vitalLabel(row), display: vitalValue(row), flag },
        `Logged ${vitalLabel(row).toLowerCase()} ${vitalValue(row)} at ${at}.${flag ? ` ${flag.message}` : ""}`,
      );
    },
  );

  server.registerTool(
    "vitals_history",
    {
      title: "Vitals history",
      description: "Readings over a period with stats per measurement (average, min, max, latest, trend) and flagged out-of-range values.",
      inputSchema: z.object({
        ...zPeriodInput,
        period: z.enum(PERIODS).default("last_30_days").describe("Named period in the user's time zone; use 'custom' with from/to"),
        type: z.enum(VITAL_TYPES).optional(),
        name: z.string().trim().max(60).optional().describe("Custom measurement name (type 'other')"),
        limit: z.number().int().min(1).max(500).default(100).describe("Max readings listed (stats use all)"),
      }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      const rows = await loadVitals(db, uid, r.from, r.to, a.type, a.name);
      const flagged = rows.map((v) => ({ v, flag: vitalFlag(v) })).filter((x) => x.flag);
      return ok(
        {
          period: r,
          stats: vitalStats(rows),
          flagged: flagged.map(({ v, flag }) => ({ id: v.id, measurement: vitalLabel(v), value: vitalValue(v), measured_at: v.measured_at, ...flag! })),
          readings: [...rows]
            .reverse()
            .slice(0, a.limit)
            .map((v) => ({ id: v.id, measurement: vitalLabel(v), value: vitalValue(v), context: v.context, measured_at: v.measured_at, note: v.note })),
        },
        rows.length ? `${rows.length} readings ${r.label.toLowerCase()}${flagged.length ? `, ${flagged.length} flagged` : ""}.` : `No readings ${r.label.toLowerCase()}.`,
      );
    },
  );

  server.registerTool(
    "delete_vital",
    { title: "Delete vital", description: "Delete a measurement by id.", inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true } },
    async (a) => {
      const res = await db.prepare("DELETE FROM vitals WHERE id = ? AND user_id = ?").bind(a.id, uid).run();
      return res.meta.changes ? ok({ deleted: a.id }, "Deleted.") : fail(`Reading ${a.id} not found`);
    },
  );

  // ---------- symptoms ----------

  server.registerTool(
    "log_symptom",
    {
      title: "Log symptom",
      description: "Record a symptom with severity 1–10, body area, when it started, duration, possible triggers and notes.",
      inputSchema: z.object({
        name: text(80).describe("e.g. Headache, Nausea, Back pain"),
        severity: z.number().int().min(1).max(10).describe("1 = barely noticeable, 10 = worst imaginable"),
        body_area: z.string().trim().max(60).optional(),
        started_at: zDateTime.optional().describe("Local 'YYYY-MM-DD HH:MM' (default now)"),
        duration: z.string().trim().max(60).optional().describe("e.g. '2 hours', 'ongoing'"),
        triggers: z.string().trim().max(200).optional(),
        note: z.string().trim().max(500).optional(),
      }),
    },
    async (a) => {
      const n = now();
      const at = a.started_at ? normStamp(a.started_at) : `${n.date} ${n.time}`;
      if (stamp(at.slice(0, 10), at.slice(11)) > stamp(n.date, n.time) + 5) return fail("started_at is in the future.");
      // Reuse the existing spelling of a symptom name so summaries group nicely.
      const prior = await db.prepare("SELECT name FROM symptoms WHERE user_id = ? AND name = ? LIMIT 1").bind(uid, a.name).first<{ name: string }>();
      const sid = id();
      const row: SymptomRow = {
        id: sid,
        name: prior?.name ?? a.name,
        severity: a.severity,
        body_area: a.body_area ?? null,
        started_at: at,
        duration: a.duration ?? null,
        triggers: a.triggers ?? null,
        note: a.note ?? null,
      };
      await db
        .prepare("INSERT INTO symptoms (id, user_id, name, severity, body_area, started_at, duration, triggers, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
        .bind(sid, uid, row.name, row.severity, row.body_area, row.started_at, row.duration, row.triggers, row.note, Date.now())
        .run();
      const recent = (await loadSymptoms(db, uid, addDays(n.date, -13), n.date, row.name)).length;
      return ok(
        { ...row, times_last_14_days: recent },
        `Logged ${row.name} (severity ${row.severity}/10) at ${at}.${recent >= 3 ? ` That's ${recent} times in 14 days — worth mentioning to your doctor.` : ""}`,
      );
    },
  );

  server.registerTool(
    "list_symptoms",
    {
      title: "List symptoms",
      description: "Symptom entries over a period, newest first, optionally filtered by name or minimum severity.",
      inputSchema: z.object({
        ...zPeriodInput,
        period: z.enum(PERIODS).default("last_30_days").describe("Named period in the user's time zone; use 'custom' with from/to"),
        name: z.string().trim().max(80).optional(),
        min_severity: z.number().int().min(1).max(10).optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      const rows = (await loadSymptoms(db, uid, r.from, r.to, a.name)).filter((s) => s.severity >= (a.min_severity ?? 1)).reverse();
      return ok({ period: r, count: rows.length, symptoms: rows.slice(0, a.limit) });
    },
  );

  server.registerTool(
    "symptom_summary",
    {
      title: "Symptom summary",
      description: "Frequency and severity per symptom over a period: count, days affected, average/max severity, first/last and trend (worsening / improving / stable).",
      inputSchema: z.object({ ...zPeriodInput, period: z.enum(PERIODS).default("last_30_days").describe("Named period in the user's time zone; use 'custom' with from/to") }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const r = resolvePeriod(user.timezone, a.period, a.from, a.to);
      const rows = await loadSymptoms(db, uid, r.from, r.to);
      return ok({ period: r, entries: rows.length, symptoms: symptomSummary(rows) });
    },
  );

  server.registerTool(
    "delete_symptom",
    { title: "Delete symptom", description: "Delete a symptom entry by id.", inputSchema: z.object({ id: z.string() }), annotations: { destructiveHint: true } },
    async (a) => {
      const res = await db.prepare("DELETE FROM symptoms WHERE id = ? AND user_id = ?").bind(a.id, uid).run();
      return res.meta.changes ? ok({ deleted: a.id }, "Deleted.") : fail(`Symptom entry ${a.id} not found`);
    },
  );

  // ---------- appointments ----------

  const getAppt = (apptId: string) =>
    db
      .prepare("SELECT id, doctor, specialty, scheduled_at, location, reason, questions, notes, outcome, status FROM appointments WHERE id = ? AND user_id = ?")
      .bind(apptId, uid)
      .first<ApptRow>();
  const questions = z.array(z.string().trim().min(1).max(300)).max(30);

  server.registerTool(
    "add_appointment",
    {
      title: "Add appointment",
      description: "Schedule a doctor / clinic appointment (local date-time) with location, reason and questions to ask. Upcoming ones appear in follow_up.",
      inputSchema: z.object({
        doctor: text(120).describe("Doctor or clinic, e.g. 'Dr. Weber'"),
        specialty: z.string().trim().max(80).optional().describe("e.g. Cardiology, GP, Dentist"),
        datetime: zDateTime.describe("Local 'YYYY-MM-DD HH:MM'"),
        location: z.string().trim().max(200).optional(),
        reason: z.string().trim().max(300).optional(),
        questions_to_ask: questions.optional(),
        notes: z.string().trim().max(1000).optional(),
      }),
    },
    async (a) => {
      const aid = id();
      await db
        .prepare("INSERT INTO appointments (id, user_id, doctor, specialty, scheduled_at, location, reason, questions, notes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
        .bind(aid, uid, a.doctor, a.specialty ?? null, normStamp(a.datetime), a.location ?? null, a.reason ?? null, JSON.stringify(uniq(a.questions_to_ask ?? [])), a.notes ?? null, Date.now())
        .run();
      const appt = fmtAppt((await getAppt(aid))!, today());
      return ok(appt, `Appointment with ${appt.doctor} on ${appt.datetime}${appt.questions.length ? ` (${appt.questions.length} questions noted)` : ""}.`);
    },
  );

  server.registerTool(
    "update_appointment",
    {
      title: "Update appointment",
      description: "Reschedule or edit an appointment; add_questions appends questions to ask, questions_to_ask replaces the list.",
      inputSchema: z.object({
        id: z.string(),
        doctor: text(120).optional(),
        specialty: z.string().trim().max(80).optional(),
        datetime: zDateTime.optional(),
        location: z.string().trim().max(200).optional(),
        reason: z.string().trim().max(300).optional(),
        questions_to_ask: questions.optional(),
        add_questions: questions.optional(),
        notes: z.string().trim().max(1000).optional(),
      }),
    },
    async (a) => {
      const appt = await getAppt(a.id);
      if (!appt) return fail(`Appointment ${a.id} not found`);
      const qs = uniq([...(a.questions_to_ask ?? JSON.parse(appt.questions)), ...(a.add_questions ?? [])]);
      await db
        .prepare(
          `UPDATE appointments SET doctor = ?1, specialty = ?2, scheduled_at = ?3, location = ?4, reason = ?5, questions = ?6, notes = ?7,
             status = CASE WHEN ?8 = 1 THEN 'scheduled' ELSE status END WHERE id = ?9 AND user_id = ?10`,
        )
        .bind(
          a.doctor ?? appt.doctor,
          a.specialty ?? appt.specialty,
          a.datetime ? normStamp(a.datetime) : appt.scheduled_at,
          a.location ?? appt.location,
          a.reason ?? appt.reason,
          JSON.stringify(qs),
          a.notes ?? appt.notes,
          a.datetime && appt.status === "cancelled" ? 1 : 0,
          a.id,
          uid,
        )
        .run();
      return ok(fmtAppt((await getAppt(a.id))!, today()), "Appointment updated.");
    },
  );

  server.registerTool(
    "list_appointments",
    {
      title: "List appointments",
      description: "Upcoming (default), past or all appointments with questions, notes and outcomes.",
      inputSchema: z.object({ when: z.enum(["upcoming", "past", "all"]).default("upcoming"), include_cancelled: z.boolean().default(false) }),
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const n = now();
      const cur = `${n.date} ${n.time}`;
      const [from, to] = a.when === "upcoming" ? [cur, "9999-12-31 23:59"] : a.when === "past" ? ["0000-01-01", cur] : ["0000-01-01", "9999-12-31 23:59"];
      let rows = await loadAppointments(db, uid, from, to, a.include_cancelled);
      if (a.when === "past") rows = rows.reverse();
      return ok({ count: rows.length, appointments: rows.map((r) => fmtAppt(r, n.date)) });
    },
  );

  server.registerTool(
    "cancel_appointment",
    { title: "Cancel appointment", description: "Mark an appointment as cancelled.", inputSchema: z.object({ id: z.string() }) },
    async (a) => {
      const res = await db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ? AND user_id = ?").bind(a.id, uid).run();
      return res.meta.changes ? ok(fmtAppt((await getAppt(a.id))!, today()), "Appointment cancelled.") : fail(`Appointment ${a.id} not found`);
    },
  );

  server.registerTool(
    "complete_appointment",
    {
      title: "Complete appointment",
      description: "Mark an appointment as done and record what came out of it (outcome, notes, next steps).",
      inputSchema: z.object({ id: z.string(), outcome: z.string().trim().max(2000).optional(), notes: z.string().trim().max(2000).optional() }),
    },
    async (a) => {
      const res = await db
        .prepare("UPDATE appointments SET status = 'completed', outcome = COALESCE(?, outcome), notes = COALESCE(?, notes) WHERE id = ? AND user_id = ?")
        .bind(a.outcome ?? null, a.notes ?? null, a.id, uid)
        .run();
      return res.meta.changes ? ok(fmtAppt((await getAppt(a.id))!, today()), "Appointment marked as completed.") : fail(`Appointment ${a.id} not found`);
    },
  );

  // ---------- health profile ----------

  server.registerTool(
    "get_health_profile",
    {
      title: "Get health profile",
      description: "Conditions, allergies, blood type, emergency contact and primary doctor.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { exists, ...p } = await loadProfile(db, uid);
      return ok(p, exists ? undefined : "No health profile yet — update_health_profile adds conditions, allergies and contacts.");
    },
  );

  const items = z.array(z.string().trim().min(1).max(120)).max(50);
  server.registerTool(
    "update_health_profile",
    {
      title: "Update health profile",
      description: "Set conditions, allergies (replace the list, or add_/remove_ individual items), blood type, emergency contact, primary doctor and notes.",
      inputSchema: z.object({
        conditions: items.optional(),
        add_conditions: items.optional(),
        remove_conditions: items.optional(),
        allergies: items.optional(),
        add_allergies: items.optional(),
        remove_allergies: items.optional(),
        blood_type: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"]).optional(),
        emergency_contact: z.string().trim().max(200).optional().describe("Name and phone"),
        primary_doctor: z.string().trim().max(200).optional(),
        notes: z.string().trim().max(1000).optional(),
      }),
    },
    async (a) => {
      const p = await loadProfile(db, uid);
      const merge = (base: string[], replace?: string[], add?: string[], remove?: string[]) => {
        const drop = new Set((remove ?? []).map((s) => s.toLowerCase()));
        return uniq([...(replace ?? base), ...(add ?? [])]).filter((s) => !drop.has(s.toLowerCase()));
      };
      const next = {
        conditions: merge(p.conditions, a.conditions, a.add_conditions, a.remove_conditions),
        allergies: merge(p.allergies, a.allergies, a.add_allergies, a.remove_allergies),
        blood_type: a.blood_type ?? p.blood_type,
        emergency_contact: a.emergency_contact ?? p.emergency_contact,
        primary_doctor: a.primary_doctor ?? p.primary_doctor,
        notes: a.notes ?? p.notes,
      };
      await db
        .prepare(
          `INSERT INTO health_profile (user_id, conditions, allergies, blood_type, emergency_contact, primary_doctor, notes, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT (user_id) DO UPDATE SET conditions = excluded.conditions, allergies = excluded.allergies, blood_type = excluded.blood_type,
             emergency_contact = excluded.emergency_contact, primary_doctor = excluded.primary_doctor, notes = excluded.notes, updated_at = excluded.updated_at`,
        )
        .bind(uid, JSON.stringify(next.conditions), JSON.stringify(next.allergies), next.blood_type, next.emergency_contact, next.primary_doctor, next.notes, Date.now())
        .run();
      return ok(next, "Health profile updated.");
    },
  );

  // ---------- follow-up & report ----------

  server.registerTool(
    "follow_up",
    {
      title: "Health follow-up",
      description:
        "Check-in: today's doses (what's due or overdue now), missed doses in the last 7 days, refills needed, courses ending, upcoming appointments with questions, concerning vitals, symptom trends, 7-day adherence and nudges.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => followUp(db, uid, now()).then((f) => ok(f)),
  );

  server.registerTool(
    "generate_report",
    {
      title: "Generate health report",
      description:
        "Doctor-ready report for a period: adherence KPIs, health profile, current medications, adherence by medication and missed doses, vitals summary and flagged readings, symptoms, appointments and refills. Returns Markdown plus a printable link.",
      inputSchema: z.object(zPeriodInput),
      annotations: { readOnlyHint: true },
    },
    async (a) => reportResult(ctx, await buildReport(ctx, resolvePeriod(user.timezone, a.period, a.from, a.to))),
  );

  return server;
}

export async function followUp(db: D1Database, uid: string, n: LocalNow) {
  const t = n.date;
  const cur = `${t} ${n.time}`;
  const week = await medicationData(db, uid, addDays(t, -7), t, n);
  const active = week.meds.filter((m) => m.active);
  const todaySlots = week.slots.filter((s) => s.date === t);
  const dueNow = todaySlots.filter((s) => s.status === "due" || s.status === "overdue");
  const missed = week.slots.filter((s) => s.date < t && s.status === "missed");
  const adh = adherence(week.meds, week.slots.filter((s) => s.date >= addDays(t, -6)), n);
  const refills = active.filter(refillNeeded);
  const ending = active.filter((m) => m.end_date && m.end_date >= t && m.end_date <= addDays(t, 7));
  const upcoming = await loadAppointments(db, uid, cur, `${addDays(t, 14)} 23:59`, false);
  const needsOutcome = (await loadAppointments(db, uid, `${addDays(t, -30)} 00:00`, cur, false)).filter((a) => a.status === "scheduled");
  const vitals = (await loadVitals(db, uid, addDays(t, -7), t)).map((v) => ({ v, flag: vitalFlag(v) })).filter((x) => x.flag);
  const symptoms = symptomSummary(await loadSymptoms(db, uid, addDays(t, -13), t)).filter((s) => s.count >= 3 || s.trend === "worsening");
  const profile = await loadProfile(db, uid);

  const nudges: string[] = [];
  for (const s of dueNow)
    nudges.push(s.status === "overdue" ? `${s.medication} (${s.time}) is overdue — did you take it?` : `${s.medication}${s.dosage ? ` ${s.dosage}` : ""} is due at ${s.time}.`);
  if (missed.length) {
    const counts = new Map<string, number>();
    for (const s of missed) counts.set(s.medication, (counts.get(s.medication) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    nudges.push(`${missed.length} dose${missed.length === 1 ? " was" : "s were"} missed or not logged in the last 7 days (most: ${top[0]}, ${top[1]}).`);
  }
  for (const m of refills) {
    const d = daysOfSupply(m);
    nudges.push(
      m.stock! < m.units_per_dose
        ? `${m.name} is out of stock — time to refill${m.pharmacy ? ` at ${m.pharmacy}` : ""}.`
        : `${m.name}: about ${d} day${d === 1 ? "" : "s"} left (${m.stock} units) — time to refill${m.pharmacy ? ` at ${m.pharmacy}` : ""}.`,
    );
  }
  for (const m of ending) nudges.push(`${m.name} course ends ${m.end_date === t ? "today" : `on ${m.end_date}`}.`);
  for (const a of upcoming) {
    const qs: string[] = JSON.parse(a.questions);
    nudges.push(
      `Appointment with ${a.doctor} on ${a.scheduled_at}${qs.length ? ` — ${qs.length} question${qs.length === 1 ? "" : "s"} ready to ask.` : " — any questions you want to note for it?"}`,
    );
  }
  for (const a of needsOutcome) nudges.push(`How did the appointment with ${a.doctor} on ${a.scheduled_at.slice(0, 10)} go? complete_appointment can record the outcome.`);
  for (const { flag } of vitals) nudges.push(flag!.message);
  for (const s of symptoms)
    nudges.push(
      s.trend === "worsening"
        ? `${s.symptom} seems to be getting worse (avg severity ${s.avg_severity}/10) — worth discussing with your doctor.`
        : `${s.symptom} logged ${s.count} times in the last 14 days — worth mentioning to your doctor.`,
    );
  if (adh.overall_percent !== null && adh.overall_percent < 80) nudges.push(`Adherence over the last 7 days is ${adh.overall_percent}% — reminders or a pill organizer might help.`);
  if (!week.meds.length) nudges.push("No medications tracked yet — add them with add_medication (or log a vital or symptom).");
  if (!profile.exists) nudges.push("Add your conditions and allergies with update_health_profile so reports for your doctor are complete.");

  return {
    today: t,
    now: n.time,
    doses_today: {
      total: todaySlots.length,
      taken: todaySlots.filter((s) => s.status === "taken").length,
      slots: todaySlots.map((s) => ({ medication: s.medication, dosage: s.dosage, time: s.time, status: s.status })),
    },
    due_now: dueNow.map((s) => ({ medication: s.medication, dosage: s.dosage, time: s.time, status: s.status })),
    missed_last_7_days: missed.map((s) => ({ medication: s.medication, date: s.date, time: s.time, logged: s.logged })),
    refills_needed: refills.map((m) => ({ medication: m.name, stock: m.stock, days_of_supply: daysOfSupply(m), threshold_days: m.refill_threshold_days, pharmacy: m.pharmacy })),
    courses_ending_soon: ending.map((m) => ({ medication: m.name, end_date: m.end_date, days_left: daysBetween(t, m.end_date!) })),
    upcoming_appointments: upcoming.map((a) => fmtAppt(a, t)),
    appointments_needing_outcome: needsOutcome.map((a) => fmtAppt(a, t)),
    concerning_vitals: vitals.map(({ v, flag }) => ({ measurement: vitalLabel(v), value: vitalValue(v), measured_at: v.measured_at, level: flag!.level, message: flag!.message })),
    symptom_trends: symptoms,
    adherence_last_7_days: { overall_percent: adh.overall_percent, taken: adh.taken, scheduled: adh.scheduled, by_medication: adh.by_medication },
    nudges,
  };
}

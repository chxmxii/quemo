import { z } from "zod";

/** Calendar date (YYYY-MM-DD) in the user's time zone. */
export function localDate(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Wall-clock time (HH:MM, 24h) in the user's time zone. */
export function localTime(tz: string, at: Date = new Date()): string {
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return t;
}

export const localMonth = (tz: string, at: Date = new Date()) => localDate(tz, at).slice(0, 7);

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday */
export const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Monday of the ISO week containing `date`. */
export const startOfWeek = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

export const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export const PERIODS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "last_7_days",
  "last_30_days",
  "last_90_days",
  "this_month",
  "last_month",
  "this_year",
  "last_year",
  "custom",
] as const;
export type Period = (typeof PERIODS)[number];

export interface DateRange {
  from: string;
  to: string;
  label: string;
  days: number;
}

/** Turns a named period (in the user's time zone) or an explicit from/to into a concrete range. */
export function resolvePeriod(tz: string, period: Period = "this_month", from?: string, to?: string): DateRange {
  const today = localDate(tz);
  const range = (f: string, t: string, label: string): DateRange => ({ from: f, to: t, label, days: daysBetween(f, t) + 1 });
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  switch (period) {
    case "today":
      return range(today, today, "Today");
    case "yesterday":
      return range(addDays(today, -1), addDays(today, -1), "Yesterday");
    case "this_week":
      return range(startOfWeek(today), today, "This week");
    case "last_week": {
      const start = addDays(startOfWeek(today), -7);
      return range(start, addDays(start, 6), "Last week");
    }
    case "last_7_days":
      return range(addDays(today, -6), today, "Last 7 days");
    case "last_30_days":
      return range(addDays(today, -29), today, "Last 30 days");
    case "last_90_days":
      return range(addDays(today, -89), today, "Last 90 days");
    case "this_month":
      return range(`${month}-01`, today, "This month");
    case "last_month": {
      const prev = addMonths(`${month}-01`, -1).slice(0, 7);
      return range(`${prev}-01`, monthEnd(prev), "Last month");
    }
    case "this_year":
      return range(`${year}-01-01`, today, "This year");
    case "last_year": {
      const y = String(Number(year) - 1);
      return range(`${y}-01-01`, `${y}-12-31`, "Last year");
    }
    case "custom": {
      const f = from ?? addDays(to ?? today, -29);
      const t = to ?? today;
      return range(f <= t ? f : t, f <= t ? t : f, `${f <= t ? f : t} → ${f <= t ? t : f}`);
    }
  }
}

// ---------- zod helpers shared by every tool ----------

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const zMonth = z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM");
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h)");

/** Standard "which period?" input: a named period, or period=custom with from/to. */
export const zPeriodInput = {
  period: z.enum(PERIODS).default("this_month").describe("Named period in the user's time zone; use 'custom' with from/to"),
  from: zDate.optional().describe("Start date when period is 'custom'"),
  to: zDate.optional().describe("End date when period is 'custom'"),
};

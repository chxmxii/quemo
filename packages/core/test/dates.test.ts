import { describe, expect, it } from "vitest";
import { addDays, addMonths, daysBetween, isValidTimezone, localDate, localTime, monthEnd, resolvePeriod, startOfWeek, weekday } from "../src/dates";

describe("dates", () => {
  it("uses the user's time zone for 'today'", () => {
    const at = new Date("2026-10-25T23:30:00Z");
    expect(localDate("UTC", at)).toBe("2026-10-25");
    expect(localDate("Europe/Berlin", at)).toBe("2026-10-26");
    expect(localDate("America/Los_Angeles", at)).toBe("2026-10-25");
    expect(localTime("Asia/Tokyo", at)).toBe("08:30");
  });

  it("does calendar arithmetic", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 2)).toBe("2027-02-15");
    expect(daysBetween("2026-10-01", "2026-10-25")).toBe(24);
    expect(weekday("2026-10-25")).toBe(0); // Sunday
    expect(startOfWeek("2026-10-25")).toBe("2026-10-19");
    expect(startOfWeek("2026-10-19")).toBe("2026-10-19");
    expect(monthEnd("2026-02")).toBe("2026-02-28");
  });

  it("validates time zones", () => {
    expect(isValidTimezone("Europe/Berlin")).toBe(true);
    expect(isValidTimezone("Mars/Base")).toBe(false);
  });

  it("resolves named periods", () => {
    const tz = "UTC";
    const today = localDate(tz);
    expect(resolvePeriod(tz, "today")).toMatchObject({ from: today, to: today, days: 1 });
    expect(resolvePeriod(tz, "last_7_days")).toMatchObject({ from: addDays(today, -6), to: today, days: 7 });
    expect(resolvePeriod(tz, "this_month").from).toBe(`${today.slice(0, 7)}-01`);
    const lm = resolvePeriod(tz, "last_month");
    expect(lm.from.slice(8)).toBe("01");
    expect(addDays(lm.to, 1)).toBe(`${today.slice(0, 7)}-01`);
    const lw = resolvePeriod(tz, "last_week");
    expect(lw.days).toBe(7);
    expect(weekday(lw.from)).toBe(1);
    expect(resolvePeriod(tz, "custom", "2026-03-10", "2026-03-01")).toMatchObject({ from: "2026-03-01", to: "2026-03-10", days: 10 });
  });
});

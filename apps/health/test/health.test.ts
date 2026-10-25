import { env } from "cloudflare:test";
import { addDays, localDate, localTime, purgeDeletedUsers } from "@quemo/core";
import { connect, fakeAuth, TEST_USER, testContext, type Caller } from "@quemo/core/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer, slotStatus, toMinutes, trendOf, type Env } from "../src/server";

const TZ = TEST_USER.timezone; // Europe/Berlin
const USER_TABLES = ["doses", "medications", "vitals", "symptoms", "appointments", "health_profile"];

let n = 0;
async function newUser(): Promise<{ mcp: Caller; userId: string }> {
  const userId = `health-user-${++n}-${crypto.randomUUID()}`;
  const ctx = testContext<Env>({ DB: env.DB, PUBLIC_URL: "http://localhost:8790" }, { ...TEST_USER, id: userId });
  return { mcp: await connect(buildServer(ctx)), userId };
}

const today = () => localDate(TZ);
const nowTime = () => localTime(TZ);
const day = (offset: number) => addDays(today(), offset);
/** Local wall-clock time `mins` minutes from now, wrapped to 00:00-23:59. */
const shift = (mins: number) => {
  const m = (((toMinutes(nowTime()) + mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

describe("medications", () => {
  let mcp: Caller;
  beforeEach(async () => ({ mcp } = await newUser()));

  it("adds a medication with a sorted schedule and days of supply", async () => {
    const med = await mcp.call("add_medication", {
      name: "Metformin",
      dosage: "500 mg",
      purpose: "Type 2 diabetes",
      instructions: "with food",
      times: ["20:00", "08:00"],
      prescriber: "Dr. Weber",
      stock: 60,
    });
    expect(med).toMatchObject({
      name: "Metformin",
      dosage: "500 mg",
      form: "pill",
      schedule: { as_needed: false, times: ["08:00", "20:00"], days: "every day", text: "08:00, 20:00 daily" },
      start_date: today(),
      stock: 60,
      units_per_dose: 1,
      days_of_supply: 30,
      refill_needed: false,
      active: true,
    });
  });

  it("updates, finds by partial name, stops, resumes and deletes", async () => {
    await mcp.call("add_medication", { name: "Metformin", dosage: "500 mg", times: ["08:00", "20:00"], stock: 60 });
    const upd = await mcp.call("update_medication", { medication: "metf", dosage: "850 mg", days: ["wed", "mon"] });
    expect(upd).toMatchObject({ dosage: "850 mg", schedule: { days: ["mon", "wed"], text: "08:00, 20:00 mon/wed" } });
    expect(upd.days_of_supply).toBe(Math.floor(60 / ((2 * 2) / 7)));

    expect((await mcp.call("list_medications")).count).toBe(1);
    const stopped = await mcp.call("stop_medication", { medication: "METFORMIN" });
    expect(stopped.active).toBe(false);
    expect(stopped.stopped_at).toMatch(new RegExp(`^${today()} \\d{2}:\\d{2}$`));
    expect(await mcp.callError("stop_medication", { medication: "Metformin" })).toMatch(/already stopped/);
    expect((await mcp.call("list_medications")).count).toBe(0);
    expect((await mcp.call("list_medications", { include_stopped: true })).medications[0].active).toBe(false);
    expect(await mcp.callError("log_dose", { medication: "Metformin" })).toMatch(/stopped/);

    const resumed = await mcp.call("update_medication", { medication: "Metformin", active: true });
    expect(resumed).toMatchObject({ active: true, stopped_at: null });

    await mcp.call("delete_medication", { medication: "Metformin" });
    expect((await mcp.call("list_medications", { include_stopped: true })).count).toBe(0);
    expect(await mcp.callError("delete_medication", { medication: "Metformin" })).toMatch(/not found/);
  });

  it("rejects invalid or inconsistent input", async () => {
    expect(await mcp.callError("add_medication", { name: "Aspirin" })).toMatch(/schedule times/);
    await expect(mcp.call("add_medication", { name: "Aspirin", times: ["8am"] })).rejects.toThrow();
    await expect(mcp.call("add_medication", { name: "Aspirin", times: ["08:00"], form: "gummy" })).rejects.toThrow();
    await expect(mcp.call("add_medication", { name: "Aspirin", times: ["08:00"], days: ["funday"] })).rejects.toThrow();
    await expect(mcp.call("add_medication", { name: "", times: ["08:00"] })).rejects.toThrow();
    expect(await mcp.callError("add_medication", { name: "Amoxicillin", times: ["08:00"], start_date: today(), end_date: day(-1) })).toMatch(/before start_date/);
    await mcp.call("add_medication", { name: "Aspirin", times: ["08:00"] });
    expect(await mcp.callError("add_medication", { name: "aspirin", times: ["09:00"] })).toMatch(/already tracked/);
    await expect(mcp.call("log_dose", { medication: "Aspirin", status: "eaten" })).rejects.toThrow();
    await expect(mcp.call("log_dose", { medication: "Aspirin", taken_at: "yesterday" })).rejects.toThrow();
    expect(await mcp.callError("log_dose", { medication: "Ibuprofen" })).toMatch(/not found/);
    expect(await mcp.callError("refill_medication", { medication: "Aspirin" })).toMatch(/quantity/);
  });
});

describe("schedule and dose logging", () => {
  it("computes slot statuses relative to the local time", () => {
    expect(slotStatus("08:00", "08:30")).toBe("due");
    expect(slotStatus("08:00", "07:00")).toBe("due");
    expect(slotStatus("08:00", "09:00")).toBe("due");
    expect(slotStatus("08:00", "09:01")).toBe("overdue");
    expect(slotStatus("10:00", "08:59")).toBe("upcoming");
  });

  it("shows today's slots as taken / due / overdue / upcoming", async () => {
    const { mcp } = await newUser();
    const [early, current, later] = [shift(-180), shift(0), shift(180)];
    await mcp.call("add_medication", { name: "Lisinopril", dosage: "10 mg", times: [early, current, later], start_date: day(-1) });
    await mcp.call("log_dose", { medication: "Lisinopril", scheduled_time: early });

    const view = await mcp.call("todays_doses");
    expect(view.date).toBe(today());
    expect(view.total).toBe(3);
    expect(view.taken).toBe(1);
    const byTime = Object.fromEntries(view.slots.map((s: any) => [s.time, s.status]));
    expect(byTime[early]).toBe("taken");
    expect(byTime[current]).toBe("due");
    expect(byTime[later]).toBe(slotStatus(later, nowTime()));
    expect(view.slots.find((s: any) => s.time === early).dose_id).toBeTruthy();
  });

  it("only schedules doses on the chosen weekdays and within the course", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_medication", { name: "Methotrexate", times: ["09:00"], days: ["mon"], start_date: day(-14) });
    await mcp.call("add_medication", { name: "Amoxicillin", times: ["09:00"], start_date: day(-10), end_date: day(-2) });
    const yesterday = await mcp.call("todays_doses", { date: day(-1) });
    const isMonday = new Date(`${day(-1)}T00:00:00Z`).getUTCDay() === 1;
    expect(yesterday.slots.map((s: any) => s.medication)).toEqual(isMonday ? ["Methotrexate"] : []);
    const earlier = await mcp.call("todays_doses", { date: day(-3) });
    expect(earlier.slots.find((s: any) => s.medication === "Amoxicillin").status).toBe("missed");
  });

  it("decrements stock when a dose is taken and keeps it in sync on changes", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_medication", { name: "Prednisone", times: ["08:00"], start_date: day(-3), stock: 10, units_per_dose: 2 });
    const d = await mcp.call("log_dose", { medication: "Prednisone", date: day(-1), scheduled_time: "08:00" });
    expect(d).toMatchObject({ status: "taken", scheduled_date: day(-1), scheduled_time: "08:00", actual_at: `${day(-1)} 08:00`, stock: 8 });

    const again = await mcp.call("log_dose", { medication: "Prednisone", date: day(-1), scheduled_time: "08:00" });
    expect(again).toMatchObject({ updated_existing: true, stock: 8 });
    expect((await mcp.call("log_dose", { medication: "Prednisone", date: day(-1), scheduled_time: "08:00", status: "skipped" })).stock).toBe(10);
    const retaken = await mcp.call("log_dose", { medication: "Prednisone", date: day(-1), scheduled_time: "08:00" });
    expect(retaken.stock).toBe(8);

    await mcp.call("delete_dose", { id: retaken.id });
    expect((await mcp.call("list_medications")).medications[0].stock).toBe(10);
    expect(await mcp.callError("log_dose", { medication: "Prednisone", date: day(-1), scheduled_time: "09:00" })).toMatch(/isn't scheduled at 09:00/);
  });

  it("matches a dose to the nearest due slot", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_medication", { name: "Levetiracetam", times: ["08:00", "13:00", "20:00"], start_date: day(-3), stock: 30 });
    const at = `${day(-1)} 12:00`;
    const first = await mcp.call("log_dose", { medication: "Levetiracetam", taken_at: at });
    expect(first).toMatchObject({ scheduled_date: day(-1), scheduled_time: "13:00", actual_at: at, stock: 29 });
    const second = await mcp.call("log_dose", { medication: "Levetiracetam", taken_at: `${day(-1)}T12:00` });
    expect(second).toMatchObject({ scheduled_date: day(-1), scheduled_time: "08:00" });
    const third = await mcp.call("log_dose", { medication: "Levetiracetam", taken_at: at });
    expect(third.scheduled_time).toBe("20:00");
    const extra = await mcp.call("log_dose", { medication: "Levetiracetam", taken_at: at });
    expect(extra).toMatchObject({ scheduled_time: null, stock: 26 });
    expect(await mcp.callError("log_dose", { medication: "Levetiracetam", taken_at: `${day(1)} 08:00` })).toMatch(/future/);
  });

  it("bulk-logs every morning dose", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_medication", { name: "Metformin", times: ["08:00", "20:00"], start_date: day(-2) });
    await mcp.call("add_medication", { name: "Vitamin D", times: ["07:30"], start_date: day(-2) });
    await mcp.call("add_medication", { name: "Atorvastatin", times: ["21:00"], start_date: day(-2) });
    await mcp.call("add_medication", { name: "Ibuprofen", as_needed: true, dosage: "400 mg" });

    const res = await mcp.call("log_doses", { part_of_day: "morning", date: day(-1) });
    expect(res.logged).toEqual([
      { medication: "Metformin", date: day(-1), time: "08:00", status: "taken" },
      { medication: "Vitamin D", date: day(-1), time: "07:30", status: "taken" },
    ]);
    expect(res.skipped).toEqual([{ medication: "Atorvastatin", reason: "nothing open in the morning" }]);
    expect(await mcp.callError("log_doses", { part_of_day: "morning", date: day(-1) })).toMatch(/Nothing to log/);

    const history = await mcp.call("dose_history", { period: "custom", from: day(-1), to: day(-1) });
    expect(history.count).toBe(2);
    expect(history.doses.map((d: any) => d.at).sort()).toEqual([`${day(-1)} 07:30`, `${day(-1)} 08:00`]);

    const prn = await mcp.call("log_doses", { medications: ["ibuprofen"] });
    expect(prn.logged).toEqual([{ medication: "Ibuprofen", date: today(), time: null, status: "taken" }]);
  });

  it("restocks with refill_medication and raises refill alerts", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_medication", { name: "Losartan", times: ["08:00", "20:00"], stock: 5, refill_threshold_days: 7, pharmacy: "Apotheke am Markt" });
    await mcp.call("add_medication", { name: "Salbutamol", form: "inhaler", as_needed: true, stock: 0 });
    await mcp.call("add_medication", { name: "Vitamin B12", times: ["08:00"], stock: 90 });

    const meds = (await mcp.call("list_medications")).medications;
    expect(meds.find((m: any) => m.name === "Losartan")).toMatchObject({ days_of_supply: 2, refill_needed: true });
    expect(meds.find((m: any) => m.name === "Salbutamol")).toMatchObject({ days_of_supply: null, refill_needed: true });
    expect(meds.find((m: any) => m.name === "Vitamin B12").refill_needed).toBe(false);

    const f = await mcp.call("follow_up");
    expect(f.refills_needed.map((r: any) => r.medication).sort()).toEqual(["Losartan", "Salbutamol"]);
    expect(f.nudges.join(" ")).toMatch(/Losartan: about 2 days left \(5 units\), time to refill at Apotheke am Markt/);
    expect(f.nudges.join(" ")).toMatch(/Salbutamol is out of stock/);

    const refilled = await mcp.call("refill_medication", { medication: "Losartan", quantity: 60 });
    expect(refilled).toMatchObject({ stock: 65, days_of_supply: 32, refill_needed: false });
    expect((await mcp.call("refill_medication", { medication: "Losartan", set_stock: 14 })).stock).toBe(14);
  });

  it("flags courses ending soon", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_medication", { name: "Amoxicillin", dosage: "500 mg", times: ["08:00", "14:00", "20:00"], start_date: day(-4), end_date: day(2) });
    const f = await mcp.call("follow_up");
    expect(f.courses_ending_soon).toEqual([{ medication: "Amoxicillin", end_date: day(2), days_left: 2 }]);
    expect(f.nudges.join(" ")).toMatch(new RegExp(`Amoxicillin course ends on ${day(2)}`));
  });
});

describe("adherence", () => {
  it("computes taken / scheduled, respecting the start date and ignoring future slots", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_medication", { name: "Metformin", times: ["08:00", "20:00"], start_date: day(-3) });
    for (const [d, t] of [
      [-3, "08:00"],
      [-3, "20:00"],
      [-2, "08:00"],
      [-1, "20:00"],
    ] as const)
      await mcp.call("log_dose", { medication: "Metformin", date: day(d), scheduled_time: t });
    await mcp.call("log_dose", { medication: "Metformin", date: day(-2), scheduled_time: "20:00", status: "skipped" });

    const now = nowTime();
    const todaysPast = ["08:00", "20:00"].filter((t) => t < now).length;
    const scheduled = 6 + todaysPast;
    const a = await mcp.call("medication_adherence", { period: "last_7_days" });
    expect(a.by_medication).toEqual([{ medication: "Metformin", scheduled, taken: 4, skipped: 1, missed: scheduled - 5, percent: Math.round((4 / scheduled) * 100) }]);
    expect(a.overall_percent).toBe(Math.round((4 / scheduled) * 100));
    expect(a.not_taken).toContainEqual({ medication: "Metformin", date: day(-1), time: "08:00", status: "not logged" });
    expect(a.not_taken).toContainEqual({ medication: "Metformin", date: day(-2), time: "20:00", status: "skipped" });

    const f = await mcp.call("follow_up");
    expect(f.missed_last_7_days).toEqual([{ medication: "Metformin", date: day(-1), time: "08:00", logged: false }]);
    expect(f.adherence_last_7_days).toMatchObject({ taken: 4, scheduled });
  });

  it("never counts as-needed medicines as missed", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_medication", { name: "Ibuprofen", as_needed: true, start_date: day(-5), stock: 20 });
    const dose = await mcp.call("log_dose", { medication: "Ibuprofen", taken_at: `${day(-2)} 15:00` });
    expect(dose).toMatchObject({ scheduled_time: null, scheduled_date: day(-2), stock: 19 });

    const a = await mcp.call("medication_adherence", { period: "last_7_days" });
    expect(a).toMatchObject({ overall_percent: null, scheduled: 0, by_medication: [], not_taken: [], as_needed_doses: 1 });
    const f = await mcp.call("follow_up");
    expect(f.missed_last_7_days).toEqual([]);
    expect(f.doses_today.total).toBe(0);
    const view = await mcp.call("todays_doses", { date: day(-2) });
    expect(view.as_needed).toEqual([expect.objectContaining({ medication: "Ibuprofen", status: "taken", at: `${day(-2)} 15:00` })]);
  });

  it("stops scheduling after a medication is stopped", async () => {
    const { mcp } = await newUser();
    await mcp.call("add_medication", { name: "Omeprazole", times: ["07:00"], start_date: day(-5) });
    await mcp.call("stop_medication", { medication: "Omeprazole" });
    const a = await mcp.call("medication_adherence", { period: "last_7_days" });
    // 5 past days, plus today's 07:00 slot only if it passed before the stop.
    expect(a.scheduled).toBe(5 + (nowTime() > "07:00" ? 1 : 0));
    expect((await mcp.call("follow_up")).doses_today.total).toBe(a.scheduled - 5);
    expect((await mcp.call("todays_doses", { date: day(1) })).total).toBe(0);
  });
});

describe("vitals", () => {
  let mcp: Caller;
  beforeEach(async () => ({ mcp } = await newUser()));

  it("flags blood pressure and computes stats with trend", async () => {
    const normal = await mcp.call("log_vital", { type: "blood_pressure", systolic: 120, diastolic: 80, measured_at: `${day(-3)} 08:00` });
    expect(normal).toMatchObject({ unit: "mmHg", display: "120/80 mmHg", flag: null });
    await mcp.call("log_vital", { type: "blood_pressure", systolic: 130, diastolic: 85, measured_at: `${day(-2)} 08:00` });
    const high = await mcp.call("log_vital", { type: "blood_pressure", systolic: 150, diastolic: 95, measured_at: `${day(-1)} 08:00`, note: "after coffee" });
    expect(high.flag).toMatchObject({ level: "attention" });
    expect(high.flag.message).toMatch(/at or above 140\/90, worth discussing with your doctor/);
    const crisis = await mcp.text("log_vital", { type: "blood_pressure", systolic: 185, diastolic: 121, measured_at: `${day(-1)} 09:00` });
    expect(crisis).toMatch(/contacting a healthcare professional promptly/);
    expect(crisis).not.toMatch(/hypertension|diagnos/i);

    const h = await mcp.call("vitals_history", { type: "blood_pressure", period: "last_7_days" });
    expect(h.stats).toEqual([
      {
        type: "blood_pressure",
        measurement: "Blood pressure",
        unit: "mmHg",
        count: 4,
        avg: "146/95",
        min: "120/80",
        max: "185/121",
        latest: "185/121",
        latest_at: `${day(-1)} 09:00`,
        trend: "rising",
        flagged: 2,
      },
    ]);
    expect(h.flagged.map((f: any) => f.level)).toEqual(["attention", "urgent"]);
    expect(h.readings[0].value).toBe("185/121 mmHg");
  });

  it("flags fever, low SpO2 and high fasting glucose; respects units", async () => {
    expect((await mcp.call("log_vital", { type: "temperature", value: 38.4 })).flag.message).toMatch(/fever/);
    expect((await mcp.call("log_vital", { type: "temperature", value: 101, unit: "F" })).flag).toMatchObject({ level: "attention" });
    expect((await mcp.call("log_vital", { type: "temperature", value: 36.8 })).flag).toBeNull();
    expect((await mcp.call("log_vital", { type: "spo2", value: 92 })).flag.message).toMatch(/below 94%/);
    expect((await mcp.call("log_vital", { type: "spo2", value: 97 })).flag).toBeNull();
    expect((await mcp.call("log_vital", { type: "blood_glucose", value: 130, context: "fasting" })).flag.message).toMatch(/fasting/);
    expect((await mcp.call("log_vital", { type: "blood_glucose", value: 6.0, unit: "mmol/l", context: "fasting" })).flag).toBeNull();
    expect((await mcp.call("log_vital", { type: "blood_glucose", value: 130, context: "after_meal" })).flag).toBeNull();
    expect((await mcp.call("log_vital", { type: "weight", value: 82.5 })).unit).toBe("kg");
    const peak = await mcp.call("log_vital", { type: "other", name: "Peak flow", value: 420, unit: "L/min" });
    expect(peak).toMatchObject({ measurement: "Peak flow", display: "420 L/min" });

    const h = await mcp.call("vitals_history", { period: "today" });
    expect(h.stats.find((s: any) => s.type === "temperature" && s.unit === "°C")).toMatchObject({ count: 2, min: 36.8, max: 38.4, avg: 37.6 });
    expect(h.flagged).toHaveLength(4);
  });

  it("rejects incomplete or implausible readings", async () => {
    expect(await mcp.callError("log_vital", { type: "blood_pressure", systolic: 120 })).toMatch(/systolic and diastolic/);
    expect(await mcp.callError("log_vital", { type: "blood_pressure", systolic: 80, diastolic: 120 })).toMatch(/higher than diastolic/);
    expect(await mcp.callError("log_vital", { type: "spo2", value: 120 })).toMatch(/percentage/);
    expect(await mcp.callError("log_vital", { type: "other", value: 3 })).toMatch(/name/);
    expect(await mcp.callError("log_vital", { type: "heart_rate" })).toMatch(/value/);
    await expect(mcp.call("log_vital", { type: "mood", value: 3 })).rejects.toThrow();
    await expect(mcp.call("log_vital", { type: "heart_rate", value: 70, measured_at: "25/10/2026 08:00" })).rejects.toThrow();
    expect(await mcp.callError("log_vital", { type: "heart_rate", value: 70, measured_at: `${day(2)} 08:00` })).toMatch(/future/);
  });

  it("detects trends", () => {
    expect(trendOf([80, 81])).toBe("stable");
    expect(trendOf([80, 85, 90, 95])).toBe("rising");
    expect(trendOf([95, 90, 85])).toBe("falling");
    expect(trendOf([80])).toBe("not enough data");
  });
});

describe("symptoms", () => {
  it("summarizes frequency, severity and trend", async () => {
    const { mcp } = await newUser();
    await mcp.call("log_symptom", { name: "Headache", severity: 4, body_area: "forehead", started_at: `${day(-5)} 14:00` });
    await mcp.call("log_symptom", { name: "headache", severity: 6, started_at: `${day(-3)} 15:00`, triggers: "screen time" });
    const third = await mcp.call("log_symptom", { name: "Headache", severity: 8, started_at: `${day(-1)} 16:00`, duration: "3 hours" });
    expect(third).toMatchObject({ name: "Headache", times_last_14_days: 3 });
    await mcp.call("log_symptom", { name: "Nausea", severity: 3, started_at: `${day(-2)} 09:00` });

    const s = await mcp.call("symptom_summary", { period: "last_7_days" });
    expect(s.entries).toBe(4);
    expect(s.symptoms[0]).toMatchObject({ symptom: "Headache", count: 3, days: 3, avg_severity: 6, max_severity: 8, trend: "worsening", body_areas: ["forehead"] });
    expect(s.symptoms[1]).toMatchObject({ symptom: "Nausea", count: 1, trend: "single entry" });

    expect((await mcp.call("list_symptoms", { min_severity: 6 })).count).toBe(2);
    expect((await mcp.call("list_symptoms", { name: "nausea" })).symptoms[0].severity).toBe(3);

    const f = await mcp.call("follow_up");
    expect(f.symptom_trends.map((x: any) => x.symptom)).toEqual(["Headache"]);
    expect(f.nudges.join(" ")).toMatch(/Headache seems to be getting worse/);
  });

  it("validates severity and deletes entries", async () => {
    const { mcp } = await newUser();
    await expect(mcp.call("log_symptom", { name: "Cough", severity: 11 })).rejects.toThrow();
    await expect(mcp.call("log_symptom", { name: "Cough", severity: 0 })).rejects.toThrow();
    const s = await mcp.call("log_symptom", { name: "Cough", severity: 2 });
    await mcp.call("delete_symptom", { id: s.id });
    expect(await mcp.callError("delete_symptom", { id: s.id })).toMatch(/not found/);
  });
});

describe("appointments and health profile", () => {
  it("shows upcoming appointments with questions in follow_up", async () => {
    const { mcp } = await newUser();
    const soon = await mcp.call("add_appointment", {
      doctor: "Dr. Weber",
      specialty: "Cardiology",
      datetime: `${day(3)} 10:30`,
      location: "Herzzentrum",
      reason: "BP check",
      questions_to_ask: ["Should I keep measuring twice a day?"],
    });
    expect(soon).toMatchObject({ datetime: `${day(3)} 10:30`, days_until: 3, status: "scheduled" });
    await mcp.call("add_appointment", { doctor: "Dr. Klein", specialty: "Dentist", datetime: `${day(20)}T09:00` });
    await mcp.call("update_appointment", { id: soon.id, add_questions: ["Is the dizziness related?", "Should I keep measuring twice a day?"] });

    const f = await mcp.call("follow_up");
    expect(f.upcoming_appointments).toHaveLength(1);
    expect(f.upcoming_appointments[0]).toMatchObject({
      doctor: "Dr. Weber",
      questions: ["Should I keep measuring twice a day?", "Is the dizziness related?"],
    });
    expect(f.nudges.join(" ")).toMatch(/Appointment with Dr\. Weber on .* 2 questions ready to ask/);
    expect((await mcp.call("list_appointments")).count).toBe(2);
  });

  it("cancels, completes and asks for outcomes of past visits", async () => {
    const { mcp } = await newUser();
    const past = await mcp.call("add_appointment", { doctor: "Dr. Roth", datetime: `${day(-2)} 11:00`, reason: "Check-up" });
    const future = await mcp.call("add_appointment", { doctor: "Dr. Lang", datetime: `${day(5)} 08:00` });
    let f = await mcp.call("follow_up");
    expect(f.appointments_needing_outcome.map((a: any) => a.doctor)).toEqual(["Dr. Roth"]);

    const done = await mcp.call("complete_appointment", { id: past.id, outcome: "Blood work ordered", notes: "Recheck in 3 months" });
    expect(done).toMatchObject({ status: "completed", outcome: "Blood work ordered" });
    await mcp.call("cancel_appointment", { id: future.id });
    f = await mcp.call("follow_up");
    expect(f.appointments_needing_outcome).toEqual([]);
    expect(f.upcoming_appointments).toEqual([]);
    expect((await mcp.call("list_appointments", { when: "past" })).appointments[0]).toMatchObject({ doctor: "Dr. Roth", status: "completed" });
    expect((await mcp.call("list_appointments", { when: "all", include_cancelled: true })).count).toBe(2);
    expect(await mcp.callError("cancel_appointment", { id: "nope" })).toMatch(/not found/);
    await expect(mcp.call("add_appointment", { doctor: "Dr. X", datetime: "tomorrow" })).rejects.toThrow();
  });

  it("stores the health profile", async () => {
    const { mcp } = await newUser();
    expect(await mcp.text("get_health_profile")).toMatch(/No health profile yet/);
    await mcp.call("update_health_profile", { conditions: ["Type 2 diabetes", "Hypertension"], allergies: ["Penicillin"], blood_type: "A+", primary_doctor: "Dr. Weber" });
    const p = await mcp.call("update_health_profile", { add_allergies: ["Peanuts", "penicillin"], remove_conditions: ["hypertension"], emergency_contact: "Anna, +49 170 000000" });
    expect(p).toMatchObject({
      conditions: ["Type 2 diabetes"],
      allergies: ["Penicillin", "Peanuts"],
      blood_type: "A+",
      primary_doctor: "Dr. Weber",
      emergency_contact: "Anna, +49 170 000000",
    });
    expect(await mcp.call("get_health_profile")).toMatchObject({ conditions: ["Type 2 diabetes"], allergies: ["Penicillin", "Peanuts"] });
    await expect(mcp.call("update_health_profile", { blood_type: "Z" })).rejects.toThrow();
  });
});

describe("follow-up and reports", () => {
  it("nudges a brand-new user", async () => {
    const { mcp } = await newUser();
    const f = await mcp.call("follow_up");
    expect(f.nudges.join(" ")).toMatch(/No medications tracked yet/);
    expect(f.nudges.join(" ")).toMatch(/update_health_profile/);
  });

  it("lists due and overdue doses in follow_up", async () => {
    const { mcp } = await newUser();
    const current = shift(0);
    await mcp.call("add_medication", { name: "Insulin", form: "injection", dosage: "10 units", times: [current] });
    const f = await mcp.call("follow_up");
    expect(f.due_now).toEqual([{ medication: "Insulin", dosage: "10 units", time: current, status: "due" }]);
    expect(f.nudges.join(" ")).toMatch(new RegExp(`Insulin 10 units is due at ${current}`));
  });

  it("generates a doctor-ready report with a printable link", async () => {
    const { mcp } = await newUser();
    await mcp.call("update_health_profile", { conditions: ["Hypertension"], allergies: ["Penicillin"] });
    await mcp.call("add_medication", { name: "Lisinopril", dosage: "10 mg", times: ["08:00"], start_date: day(-5), purpose: "Blood pressure", prescriber: "Dr. Weber", stock: 3 });
    await mcp.call("add_medication", { name: "Ibuprofen", as_needed: true });
    for (const d of [-5, -4, -3, -2]) await mcp.call("log_dose", { medication: "Lisinopril", date: day(d), scheduled_time: "08:00" });
    await mcp.call("log_dose", { medication: "Ibuprofen", taken_at: `${day(-1)} 18:00` });
    await mcp.call("log_vital", { type: "blood_pressure", systolic: 150, diastolic: 95, measured_at: `${day(-1)} 08:00` });
    await mcp.call("log_vital", { type: "heart_rate", value: 72, measured_at: `${day(-1)} 08:00` });
    await mcp.call("log_symptom", { name: "Dizziness", severity: 5, started_at: `${day(-2)} 10:00` });
    await mcp.call("add_appointment", { doctor: "Dr. Weber", datetime: `${day(3)} 10:00`, questions_to_ask: ["Adjust dose?"] });

    const md = await mcp.text("generate_report", { period: "last_7_days" });
    for (const heading of [
      "# Health Report",
      "## Health profile",
      "## Current medications",
      "## Adherence by medication",
      "## Missed doses",
      "## As-needed & extra doses",
      "## Vitals summary",
      "## Flagged readings",
      "## Symptoms",
      "## Symptom timeline",
      "## Appointments in this period",
      "## Upcoming appointments",
      "## Refills needed",
    ])
      expect(md).toContain(heading);
    expect(md).toContain("> Quemo is a tracking tool, not medical advice. Share this report with your healthcare provider.");
    expect(md).toMatch(/http:\/\/localhost:8790\/reports\/[a-f0-9]{40}/);
    expect(md).toContain("Hypertension");
    expect(md).toContain("| Lisinopril | 10 mg | pill | 08:00 daily | Blood pressure |");
    expect(md).toMatch(/\*\*Lisinopril\*\*, \d+% \(4\/\d\)/);
    expect(md).toContain("Adjust dose?");
    expect(md).toMatch(/1 reading was outside the usual range/);
    expect(md).toMatch(/Most frequent symptom: Dizziness/);
    expect(md).toMatch(/Refill needed soon: Lisinopril/);
    expect(md).toContain("| Ibuprofen | 1 |");
  });

  it("renders every section's empty message for a new user", async () => {
    const { mcp } = await newUser();
    const md = await mcp.text("generate_report", { period: "this_month" });
    expect(md).toContain("_No current medications._");
    expect(md).toContain("_No scheduled doses in this period._");
    expect(md).toContain("_No vitals or measurements logged in this period._");
    expect(md).toContain("_No symptoms logged in this period._");
    expect(md).toContain("Nothing tracked in this period yet.");
    expect(md).toContain("Quemo is a tracking tool, not medical advice.");
  });
});

describe("isolation and lifecycle", () => {
  it("never shows one user's data to another", async () => {
    const a = await newUser();
    const b = await newUser();
    const med = await a.mcp.call("add_medication", { name: "Secretol", times: ["08:00"], stock: 10 });
    const vital = await a.mcp.call("log_vital", { type: "weight", value: 70 });
    const appt = await a.mcp.call("add_appointment", { doctor: "Dr. A", datetime: `${day(2)} 09:00` });
    await a.mcp.call("update_health_profile", { conditions: ["Private"] });

    expect((await b.mcp.call("list_medications", { include_stopped: true })).count).toBe(0);
    expect(await b.mcp.callError("log_dose", { medication: med.id })).toMatch(/not found/);
    expect(await b.mcp.callError("delete_medication", { medication: "Secretol" })).toMatch(/not found/);
    expect(await b.mcp.callError("delete_vital", { id: vital.id })).toMatch(/not found/);
    expect(await b.mcp.callError("complete_appointment", { id: appt.id })).toMatch(/not found/);
    expect((await b.mcp.call("vitals_history")).readings).toEqual([]);
    expect((await b.mcp.call("follow_up")).upcoming_appointments).toEqual([]);
    expect((await b.mcp.call("get_health_profile")).conditions).toEqual([]);
  });

  it("purges data of deleted accounts", async () => {
    const { mcp, userId } = await newUser();
    await mcp.call("add_medication", { name: "Gone", times: ["08:00"], start_date: day(-1) });
    await mcp.call("log_dose", { medication: "Gone", date: day(-1), scheduled_time: "08:00" });
    await mcp.call("log_vital", { type: "heart_rate", value: 60 });
    await mcp.call("log_symptom", { name: "Cough", severity: 2 });
    await mcp.call("add_appointment", { doctor: "Dr. Gone", datetime: `${day(1)} 09:00` });
    await mcp.call("update_health_profile", { allergies: ["Dust"] });
    await mcp.text("generate_report");

    const removed = await purgeDeletedUsers({ DB: env.DB, AUTH: fakeAuth(TEST_USER, [userId]), PUBLIC_URL: "", AUTH_URL: "" }, USER_TABLES);
    expect(removed).toBe(1);
    for (const t of [...USER_TABLES, "reports"])
      expect(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).bind(userId).first("n")).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { buildClock } from "@/lib/time/company-clock";

const BASE = { timezone: "Asia/Kolkata", workingDays: ["mon", "tue", "wed", "thu", "fri"], lateThresholdMinutes: 10 };
const nineToSix = (extra = {}) => buildClock({ ...BASE, workingHours: { start: "09:00", end: "18:00" }, ...extra });

// 2026-09-28 is a Monday, 2026-09-26 a Saturday.
describe("working days", () => {
  it("counts a weekday and not a Saturday", () => {
    const c = nineToSix();
    expect(c.isWorkingDay("2026-09-28")).toBe(true);
    expect(c.isWorkingDay("2026-09-26")).toBe(false);
  });

  it("lets a shift add Saturday", () => {
    const c = buildClock({ ...BASE, workingDays: [...BASE.workingDays, "sat"], workingHours: { start: "10:00", end: "16:00" } });
    expect(c.isWorkingDay("2026-09-26")).toBe(true);
  });
});

describe("holidays", () => {
  it("stops a holiday counting as a working day", () => {
    const c = nineToSix({ holidays: ["2026-09-28"] });
    expect(c.isWorkingDay("2026-09-28")).toBe(false);
  });

  it("leaves other days alone", () => {
    const c = nineToSix({ holidays: ["2026-09-28"] });
    expect(c.isWorkingDay("2026-09-29")).toBe(true);
  });

  it("exposes the set so callers need not re-query", () => {
    expect(nineToSix({ holidays: ["2026-09-28"] }).holidays.has("2026-09-28")).toBe(true);
  });
});

describe("shift length", () => {
  it("is nine hours for 09:00-18:00", () => {
    expect(nineToSix().scheduledSeconds).toBe(9 * 3600);
  });

  /*
   * The one that matters: a night shift ends before it starts, and a plain subtraction makes that
   * negative - which would silently turn every night worker's day into minus fifteen hours.
   */
  it("wraps an overnight shift instead of going negative", () => {
    const night = buildClock({ ...BASE, workingHours: { start: "22:00", end: "07:00" } });
    expect(night.scheduledSeconds).toBe(9 * 3600);
  });

  it("remembers which shift it was built from", () => {
    expect(buildClock({ ...BASE, workingHours: { start: "22:00", end: "07:00" }, shiftName: "Night" }).shiftName).toBe("Night");
    expect(nineToSix().shiftName).toBeNull();
  });
});

describe("day ranges", () => {
  it("is inclusive at both ends", () => {
    const days = nineToSix().days("2026-09-01", "2026-09-30");
    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-09-01");
    expect(days.at(-1)).toBe("2026-09-30");
  });

  it("crosses a month boundary", () => {
    expect(nineToSix().days("2026-09-29", "2026-10-02")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});

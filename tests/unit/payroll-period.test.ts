/**
 * Which days a month's pay covers.
 *
 * This is the foundation the whole of payroll sits on, and it is the kind of
 * code that is wrong in ways nobody notices for a month: a period that is a day
 * short docks somebody a day's pay, and one that overlaps the next pays them
 * twice. The property worth holding onto is that **every day of the year belongs
 * to exactly one period** - no gaps, no overlaps - and the last test checks that
 * directly rather than trusting the examples above it.
 */
import { describe, it, expect } from "vitest";
import { payrollPeriod, payrollMonthOf, daysInMonth } from "@/lib/time/payroll-period";

describe("a 26th-to-25th cycle", () => {
  it("runs from the 26th of the previous month to the 25th", () => {
    const p = payrollPeriod(26, "2026-09");
    expect(p.from).toBe("2026-08-26");
    expect(p.to).toBe("2026-09-25");
  });

  it("is named after the month it ends in, which is when people are paid", () => {
    expect(payrollPeriod(26, "2026-09").key).toBe("2026-09");
  });

  it("reads as a range a person would recognise", () => {
    expect(payrollPeriod(26, "2026-09").label).toBe("26 Aug - 25 Sep 2026");
  });

  it("crosses into the previous year in January", () => {
    const p = payrollPeriod(26, "2026-01");
    expect(p.from).toBe("2025-12-26");
    expect(p.to).toBe("2026-01-25");
    expect(p.label).toBe("26 Dec 2025 - 25 Jan 2026");
  });

  it("handles February without losing days", () => {
    const p = payrollPeriod(26, "2026-03");
    expect(p.from).toBe("2026-02-26");
    expect(p.to).toBe("2026-03-25");
  });
});

describe("a plain calendar cycle", () => {
  it("covers the whole month", () => {
    const p = payrollPeriod(1, "2026-09");
    expect(p).toMatchObject({ from: "2026-09-01", to: "2026-09-30", calendar: true, label: "September 2026" });
  });

  it("knows February's length, leap year included", () => {
    expect(payrollPeriod(1, "2026-02").to).toBe("2026-02-28");
    expect(payrollPeriod(1, "2028-02").to).toBe("2028-02-29");
    expect(daysInMonth(2028, 2)).toBe(29);
  });
});

describe("a cycle starting late in the month", () => {
  it("clamps the close to the last day when the month is too short", () => {
    // February's cycle closes on the 28th because there is no 30th. March then
    // starts the day *after* that - not on "the 31st of February, clamped",
    // which would hand the 28th to both months and pay for it twice.
    expect(payrollPeriod(31, "2026-02").to).toBe("2026-02-28");
    const march = payrollPeriod(31, "2026-03");
    expect(march.from).toBe("2026-03-01");
    expect(march.to).toBe("2026-03-30");
  });

  it("reads sensibly when a clamped period sits inside one month", () => {
    expect(payrollPeriod(31, "2026-03").label).toBe("1 - 30 Mar 2026");
  });

  it("clamps a 30th cycle in February too", () => {
    expect(payrollPeriod(30, "2026-02").to).toBe("2026-02-28");
    expect(payrollPeriod(30, "2026-03").from).toBe("2026-03-01");
  });
});

describe("which month a day belongs to", () => {
  it.each([
    ["2026-08-25", "2026-08"],
    ["2026-08-26", "2026-09"],
    ["2026-09-01", "2026-09"],
    ["2026-09-25", "2026-09"],
    ["2026-09-26", "2026-10"],
    ["2026-12-26", "2027-01"],
  ])("puts %s in %s on a 26th cycle", (day, month) => {
    expect(payrollMonthOf(26, day)).toBe(month);
  });

  it("is just the calendar month on a 1st cycle", () => {
    expect(payrollMonthOf(1, "2026-09-26")).toBe("2026-09");
  });
});

describe("the property that actually matters", () => {
  it.each([1, 15, 26, 28, 30, 31])("covers every day of a year exactly once with a %ith cycle", (startDay) => {
    // Walk a whole year day by day. Each day must fall inside the period of the
    // month it is assigned to - which makes gaps and overlaps both impossible.
    const seen = new Map<string, string>();
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= daysInMonth(2026, m); d++) {
        const day = `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const month = payrollMonthOf(startDay, day);
        const period = payrollPeriod(startDay, month);
        expect(day >= period.from && day <= period.to, `${day} is outside ${month} (${period.from}..${period.to})`).toBe(true);
        expect(seen.has(day)).toBe(false);
        seen.set(day, month);
      }
    }
    expect(seen.size).toBe(365);
  });

  it("leaves no gap between one period and the next", () => {
    for (const startDay of [1, 26, 31]) {
      for (let m = 2; m <= 12; m++) {
        const prev = payrollPeriod(startDay, `2026-${String(m - 1).padStart(2, "0")}`);
        const next = payrollPeriod(startDay, `2026-${String(m).padStart(2, "0")}`);
        const dayAfterPrev = new Date(`${prev.to}T12:00:00Z`);
        dayAfterPrev.setUTCDate(dayAfterPrev.getUTCDate() + 1);
        expect(dayAfterPrev.toISOString().slice(0, 10), `gap before ${next.key} on a ${startDay} cycle`).toBe(next.from);
      }
    }
  });

  it("refuses something that is not a month", () => {
    expect(() => payrollPeriod(26, "nonsense")).toThrow();
    expect(() => payrollPeriod(26, "2026-13")).toThrow();
  });
});

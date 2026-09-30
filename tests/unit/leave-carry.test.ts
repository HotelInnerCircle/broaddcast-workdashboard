/**
 * Carrying unused leave into the next year.
 *
 * The fold is the part worth pinning: what was left at the end of one year
 * opens the next, as far back as the year somebody joined, capped where the
 * policy caps it. Before it existed, every balance reset each January and a
 * year of unused earned leave simply disappeared - which is money, since it is
 * owed when a person leaves.
 *
 * The maths is reproduced here rather than imported, because the service needs
 * a database. What is pinned is the rule; the browser suite proves the service
 * applies it.
 */
import { describe, it, expect } from "vitest";

interface Policy { daysPerYear: number; monthlyAccrual: boolean; carryForward: boolean; carryForwardMax: number }

/** A twelfth lands at the start of each month, so January already holds one. */
const monthsIn = (year: number, now: number, month: number) => (year < now ? 12 : year > now ? 0 : month);

function fold(
  years: number[],
  policy: (y: number) => Policy,
  used: (y: number) => number,
  opts: { now: number; month: number },
): number {
  let carried = 0;
  for (const y of years) {
    const pol = policy(y);
    const accrued = pol.monthlyAccrual ? (pol.daysPerYear / 12) * monthsIn(y, opts.now, opts.month) : pol.daysPerYear;
    const closing = Math.max(0, carried + accrued - used(y));
    carried = pol.carryForward ? (pol.carryForwardMax ? Math.min(closing, pol.carryForwardMax) : closing) : 0;
  }
  return Math.floor(carried * 2) / 2;
}

const earned: Policy = { daysPerYear: 15, monthlyAccrual: true, carryForward: true, carryForwardMax: 30 };
const casual: Policy = { daysPerYear: 12, monthlyAccrual: true, carryForward: false, carryForwardMax: 0 };

describe("what survives the year", () => {
  it("carries what nobody used", () => {
    // A full year of 15, four taken: 11 open the next year.
    expect(fold([2025], () => earned, () => 4, { now: 2026, month: 1 })).toBe(11);
  });

  it("carries nothing for a kind that does not carry", () => {
    // Casual leave is meant to be taken in the year it is given.
    expect(fold([2025], () => casual, () => 4, { now: 2026, month: 1 })).toBe(0);
  });

  it("stops at the cap, however long somebody has been here", () => {
    // Fifteen a year, none taken, five years: 75 earned, capped at 30.
    const years = [2021, 2022, 2023, 2024, 2025];
    expect(fold(years, () => earned, () => 0, { now: 2026, month: 1 })).toBe(30);
  });

  it("carries without limit when the cap is zero", () => {
    const uncapped = { ...earned, carryForwardMax: 0 };
    expect(fold([2023, 2024, 2025], () => uncapped, () => 0, { now: 2026, month: 1 })).toBe(45);
  });

  it("never carries a debt", () => {
    // More taken than earned is somebody's overdraft to settle, not a negative
    // opening balance that quietly eats next year's leave.
    expect(fold([2025], () => earned, () => 20, { now: 2026, month: 1 })).toBe(0);
  });

  it("only counts the months that have actually happened", () => {
    // Three months into the current year is a quarter of the allowance.
    const accrued = (15 / 12) * monthsIn(2026, 2026, 3);
    expect(accrued).toBeCloseTo(3.75, 5);
    expect(Math.floor(accrued * 2) / 2).toBe(3.5);
  });

  it("lands on half days, rounded down", () => {
    // 0.75 of a day is not bookable; 0.5 is. Down, because rounding up hands
    // out leave that has not been earned and is paid for on the way out.
    expect(fold([2025], () => ({ ...earned, daysPerYear: 1 }), () => 0, { now: 2026, month: 1 })).toBe(1);
    expect(Math.floor(0.75 * 2) / 2).toBe(0.5);
  });
});

describe("the whole year, given on day one", () => {
  /*
   * What the owner actually asked for (A125): nothing comes off a balance
   * except leave somebody applied for. Accruing made September read 0.5 out of
   * 1 with nothing taken, and a number below the allowance reads as a
   * deduction - so the default is now the whole year up front.
   */
  const whole: Policy = { daysPerYear: 12, monthlyAccrual: false, carryForward: false, carryForwardMax: 0 };

  const balance = (pol: Policy, used: number, month: number) => {
    const accrued = pol.monthlyAccrual ? (pol.daysPerYear / 12) * month : pol.daysPerYear;
    return Math.floor((accrued - used) * 2) / 2;
  };

  it("shows the full allowance in January with nothing taken", () => {
    expect(balance(whole, 0, 1)).toBe(12);
  });

  it("still shows the full allowance in September with nothing taken", () => {
    // The month must not matter when the year is granted up front.
    expect(balance(whole, 0, 9)).toBe(12);
  });

  it("comes down only by what was applied for", () => {
    expect(balance(whole, 2, 9)).toBe(10);
    expect(balance(whole, 2.5, 9)).toBe(9.5);
  });

  it("an accruing policy is the thing that looked like a cut", () => {
    // Kept as an option, and the balance row now says so out loud rather than
    // leaving somebody to conclude their leave was taken from them.
    const accruing: Policy = { ...whole, daysPerYear: 1, monthlyAccrual: true };
    expect(balance(accruing, 0, 9)).toBe(0.5);
  });
});

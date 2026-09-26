/**
 * What a person is paid, checked against a payslip that was actually issued.
 *
 * The first block reproduces a real April 2026 slip line by line - the owner's
 * own, for a full stack developer on a gross of 33,000. If this file goes green
 * the maths agrees with what the company has already paid somebody; if a line
 * here changes, somebody's pay changed, and that should be deliberate.
 *
 * The rest covers what that one slip cannot: unpaid days, the PF ceiling from
 * both sides, ESI eligibility, and the rounding that decides whether a payslip
 * adds up to what it prints.
 */
import { describe, it, expect } from "vitest";
import { computePayslip, rupeesInWords, grossOf, type SalaryScale, type StatutoryRules, type ManualAdjustments } from "@/lib/payroll/compute";

/** The rules as the owner's company runs them: PF on, ESI on, Telangana PT. */
const RULES: StatutoryRules = {
  pf: { enabled: true, employeeRate: 12, wageCeiling: 15_000 },
  esi: { enabled: true, employeeRate: 0.75, wageLimit: 21_000 },
  professionalTax: { amount: 200, minGross: 20_000 },
};

const NOTHING: ManualAdjustments = { tds: 0, latePenalty: 0, advance: 0, otherEarnings: 0, otherEarningsLabel: null };

/** Allala Rahul's scale, from the April 2026 slip. */
const RAHUL: SalaryScale = { basic: 16_500, hra: 13_200, conveyance: 1_320, lta: 1_980, special: 0 };

describe("the April 2026 payslip, reproduced", () => {
  // 26 March to 25 April is 31 days, all of them paid.
  const result = computePayslip(RAHUL, { totalDays: 31, paidDays: 31, lossOfPayDays: 0, holidays: 0 }, RULES, NOTHING);

  it("has the scale that was on it", () => {
    expect(result.scale).toMatchObject({ basic: 16_500, hra: 13_200, conveyance: 1_320, lta: 1_980, gross: 33_000 });
  });

  it("earns every line in full for a full month", () => {
    expect(result.earnings).toMatchObject({ basic: 16_500, hra: 13_200, conveyance: 1_320, lta: 1_980 });
    expect(result.earnings.total).toBe(33_000);
  });

  it("deducts EPF 1,800 - twelve per cent of the ceiling, not of the basic", () => {
    // The basic is 16,500; twelve per cent of that is 1,980. The slip says 1,800,
    // because PF is capped at a wage of 15,000. This single line is the one most
    // often got wrong.
    expect(result.deductions.epf).toBe(1_800);
  });

  it("deducts no ESI, because the gross is over the limit", () => {
    expect(result.deductions.esi).toBe(0);
  });

  it("deducts professional tax of 200", () => {
    expect(result.deductions.professionalTax).toBe(200);
  });

  it("totals the deductions at 2,000", () => {
    expect(result.deductions.total).toBe(2_000);
  });

  it("pays 31,000 net", () => {
    expect(result.net).toBe(31_000);
  });

  it("writes it the way the slip does", () => {
    expect(result.netInWords).toBe("Thirty One Thousand only");
  });
});

describe("unpaid days", () => {
  it("prorates every line by the days actually paid", () => {
    // Four days of loss of pay in a 31 day period.
    const r = computePayslip(RAHUL, { totalDays: 31, paidDays: 27, lossOfPayDays: 4, holidays: 0 }, RULES, NOTHING);
    expect(r.earnings.basic).toBe(Math.round(16_500 * 27 / 31));
    expect(r.earnings.total).toBeLessThan(33_000);
  });

  it("adds up to exactly what it prints", () => {
    // The total is the sum of the rounded lines, not the rounded sum. A payslip
    // whose column does not add up is the first thing somebody notices.
    for (const paid of [1, 7, 13, 17, 23, 29, 30, 31]) {
      const r = computePayslip(RAHUL, { totalDays: 31, paidDays: paid, lossOfPayDays: 31 - paid, holidays: 0 }, RULES, NOTHING);
      const sum = r.earnings.basic + r.earnings.hra + r.earnings.conveyance + r.earnings.lta + r.earnings.special + r.earnings.other;
      expect(sum, `${paid} paid days`).toBe(r.earnings.total);
      expect(r.earnings.total - r.deductions.total).toBe(r.net);
    }
  });

  it("pays nothing for a month with no paid days, and does not go negative", () => {
    const r = computePayslip(RAHUL, { totalDays: 30, paidDays: 0, lossOfPayDays: 30, holidays: 0 }, RULES, NOTHING);
    expect(r.earnings.total).toBe(0);
    expect(r.net).toBe(0);
  });

  it("never pays a negative amount, even when deductions exceed earnings", () => {
    const r = computePayslip(RAHUL, { totalDays: 31, paidDays: 1, lossOfPayDays: 30, holidays: 0 }, RULES,
      { ...NOTHING, advance: 50_000 });
    expect(r.net).toBe(0);
  });

  it("cannot be paid for more days than the period has", () => {
    const r = computePayslip(RAHUL, { totalDays: 30, paidDays: 45, lossOfPayDays: 0, holidays: 0 }, RULES, NOTHING);
    expect(r.attendance.paidDays).toBe(30);
    expect(r.earnings.total).toBe(33_000);
  });
});

describe("the provident fund ceiling", () => {
  it("takes twelve per cent of the basic when it is under the ceiling", () => {
    const low: SalaryScale = { basic: 10_000, hra: 4_000, conveyance: 1_000, lta: 0, special: 0 };
    const r = computePayslip(low, { totalDays: 30, paidDays: 30, lossOfPayDays: 0, holidays: 0 }, RULES, NOTHING);
    expect(r.deductions.epf).toBe(1_200);
  });

  it("stops at the ceiling once the basic passes it", () => {
    for (const basic of [15_000, 16_500, 40_000, 100_000]) {
      const r = computePayslip({ ...RAHUL, basic }, { totalDays: 30, paidDays: 30, lossOfPayDays: 0, holidays: 0 }, RULES, NOTHING);
      expect(r.deductions.epf, `basic ${basic}`).toBe(1_800);
    }
  });

  it("is nothing at all when PF is switched off", () => {
    const r = computePayslip(RAHUL, { totalDays: 30, paidDays: 30, lossOfPayDays: 0, holidays: 0 },
      { ...RULES, pf: { ...RULES.pf, enabled: false } }, NOTHING);
    expect(r.deductions.epf).toBe(0);
  });
});

describe("employees' state insurance", () => {
  const lowPaid: SalaryScale = { basic: 9_000, hra: 4_000, conveyance: 1_500, lta: 0, special: 500 };

  it("applies under the wage limit", () => {
    const r = computePayslip(lowPaid, { totalDays: 30, paidDays: 30, lossOfPayDays: 0, holidays: 0 }, RULES, NOTHING);
    expect(grossOf(lowPaid)).toBe(15_000);
    expect(r.deductions.esi).toBe(Math.round(15_000 * 0.0075));
  });

  it("is judged on the full monthly gross, not on a short month", () => {
    // Otherwise a month of unpaid leave would pull somebody over the limit into
    // ESI who is not eligible for it - and back out again the following month.
    const r = computePayslip(RAHUL, { totalDays: 31, paidDays: 10, lossOfPayDays: 21, holidays: 0 }, RULES, NOTHING);
    expect(r.deductions.esi).toBe(0);
  });
});

describe("professional tax", () => {
  it("is a flat amount and does not prorate with attendance", () => {
    const r = computePayslip(RAHUL, { totalDays: 31, paidDays: 5, lossOfPayDays: 26, holidays: 0 }, RULES, NOTHING);
    expect(r.deductions.professionalTax).toBe(200);
  });

  it("is not charged below the state threshold", () => {
    const small: SalaryScale = { basic: 8_000, hra: 3_000, conveyance: 0, lta: 0, special: 0 };
    const r = computePayslip(small, { totalDays: 30, paidDays: 30, lossOfPayDays: 0, holidays: 0 }, RULES, NOTHING);
    expect(r.deductions.professionalTax).toBe(0);
  });
});

describe("what HR types in", () => {
  it("takes TDS, a late penalty and an advance off the net", () => {
    const r = computePayslip(RAHUL, { totalDays: 31, paidDays: 31, lossOfPayDays: 0, holidays: 0 }, RULES,
      { ...NOTHING, tds: 1_500, latePenalty: 300, advance: 2_000 });
    expect(r.deductions.total).toBe(2_000 + 1_500 + 300 + 2_000);
    expect(r.net).toBe(33_000 - r.deductions.total);
  });

  it("adds arrears or a bonus to the earnings", () => {
    const r = computePayslip(RAHUL, { totalDays: 31, paidDays: 31, lossOfPayDays: 0, holidays: 0 }, RULES,
      { ...NOTHING, otherEarnings: 5_000, otherEarningsLabel: "Arrears" });
    expect(r.earnings.other).toBe(5_000);
    expect(r.earnings.total).toBe(38_000);
    expect(r.net).toBe(36_000);
  });
});

describe("amounts in words", () => {
  it.each([
    [0, "Zero only"],
    [1, "One only"],
    [200, "Two Hundred only"],
    [1_800, "One Thousand Eight Hundred only"],
    [31_000, "Thirty One Thousand only"],
    [33_000, "Thirty Three Thousand only"],
    [100_000, "One Lakh only"],
    [125_500, "One Lakh Twenty Five Thousand Five Hundred only"],
    [10_000_000, "One Crore only"],
    [12_34_567, "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven only"],
  ])("writes %i as %s", (amount, words) => {
    expect(rupeesInWords(amount)).toBe(words);
  });

  it("rounds to whole rupees rather than writing paise", () => {
    expect(rupeesInWords(30_999.6)).toBe("Thirty One Thousand only");
  });
});

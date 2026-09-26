/**
 * What one person is paid for one month.
 *
 * Deliberately a pure function with no database in it, because this is the part
 * where being wrong costs somebody money. Everything it needs is passed in, so
 * it can be tested against a real payslip line by line - which it is.
 *
 * Every rounding and capping decision below is a choice, and each is written
 * down rather than left to be inferred, because "why is my PF eighteen hundred
 * and not nineteen-eighty" is a question somebody will ask.
 */

/** The monthly full-month amounts: a person's "scale". */
export interface SalaryScale {
  basic: number;
  hra: number;
  conveyance: number;
  lta: number;
  special: number;
}

export interface StatutoryRules {
  /** Employees' Provident Fund. 12% of basic, capped at a wage ceiling. */
  pf: { enabled: boolean; employeeRate: number; wageCeiling: number };
  /** Employees' State Insurance. Only for people under the wage limit. */
  esi: { enabled: boolean; employeeRate: number; wageLimit: number };
  /** Professional tax: a flat monthly amount above a gross threshold, set by the state. */
  professionalTax: { amount: number; minGross: number };
}

export interface AttendanceForPay {
  /** Days in the payroll period. On a 26th cycle, 26 March to 25 April is 31. */
  totalDays: number;
  /** Days that earn pay - present, leave, holidays and week-offs all count. */
  paidDays: number;
  lossOfPayDays: number;
  holidays: number;
}

/** Amounts nobody can compute from attendance: HR types these in. */
export interface ManualAdjustments {
  tds: number;
  latePenalty: number;
  advance: number;
  /** Anything extra owed this month - arrears, a bonus, a correction to a past month. */
  otherEarnings: number;
  otherEarningsLabel: string | null;
}

export interface PayslipComputation {
  scale: SalaryScale & { gross: number };
  attendance: AttendanceForPay;
  earnings: SalaryScale & { other: number; total: number };
  deductions: { esi: number; epf: number; professionalTax: number; tds: number; latePenalty: number; advance: number; total: number };
  net: number;
  netInWords: string;
}

export const emptyScale = (): SalaryScale => ({ basic: 0, hra: 0, conveyance: 0, lta: 0, special: 0 });
export const grossOf = (s: SalaryScale) => s.basic + s.hra + s.conveyance + s.lta + s.special;

/** Money is whole rupees on a payslip. Half a rupee rounds up, as it does everywhere else. */
const rupees = (n: number) => Math.max(0, Math.round(n));

export function computePayslip(
  scale: SalaryScale,
  attendance: AttendanceForPay,
  rules: StatutoryRules,
  manual: ManualAdjustments,
): PayslipComputation {
  const gross = grossOf(scale);
  const totalDays = Math.max(1, attendance.totalDays);
  const paidDays = Math.min(Math.max(0, attendance.paidDays), totalDays);

  /*
   * Each component is prorated and rounded on its own, and the total is the sum
   * of those rounded lines - not the rounded total. They can differ by a rupee,
   * and when they do, the payslip must add up to what it shows: somebody will
   * check it with a calculator.
   */
  const ratio = paidDays / totalDays;
  const earned: SalaryScale = {
    basic: rupees(scale.basic * ratio),
    hra: rupees(scale.hra * ratio),
    conveyance: rupees(scale.conveyance * ratio),
    lta: rupees(scale.lta * ratio),
    special: rupees(scale.special * ratio),
  };
  const other = rupees(manual.otherEarnings);
  const totalEarned = grossOf(earned) + other;

  /*
   * PF is 12% of basic, but only of basic up to the ceiling - that is why
   * somebody on a basic of 16,500 pays 1,800 and not 1,980. The cap applies to
   * what was actually earned, so a half-month is capped at the same ceiling
   * rather than half of it; that is the common reading, and the alternative
   * would quietly reduce the contribution of anybody who took unpaid leave.
   */
  const epf = rules.pf.enabled ? rupees(Math.min(earned.basic, rules.pf.wageCeiling) * (rules.pf.employeeRate / 100)) : 0;

  /*
   * ESI is only for people under the wage limit, and the test is against the
   * full monthly gross rather than what was earned this month - otherwise a
   * month of unpaid leave would pull somebody into ESI who is not eligible for it.
   */
  const esi = rules.esi.enabled && gross <= rules.esi.wageLimit
    ? rupees(totalEarned * (rules.esi.employeeRate / 100))
    : 0;

  /* Professional tax is a flat state amount, and it does not prorate. */
  const professionalTax = gross >= rules.professionalTax.minGross ? rupees(rules.professionalTax.amount) : 0;

  const tds = rupees(manual.tds);
  const latePenalty = rupees(manual.latePenalty);
  const advance = rupees(manual.advance);
  const totalDeductions = esi + epf + professionalTax + tds + latePenalty + advance;

  // Never negative: a deduction larger than the earnings is a data problem, and
  // a payslip promising a negative payment helps nobody.
  const net = Math.max(0, totalEarned - totalDeductions);

  return {
    scale: { ...scale, gross },
    attendance: { ...attendance, totalDays, paidDays },
    earnings: { ...earned, other, total: totalEarned },
    deductions: { esi, epf, professionalTax, tds, latePenalty, advance, total: totalDeductions },
    net,
    netInWords: rupeesInWords(net),
  };
}

/* ------------------------------------------------------------------ in words */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underThousand(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : "");
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${underThousand(n % 100)}` : ""}`;
}

/**
 * "Thirty One Thousand only", in the Indian system - lakh and crore, not million.
 *
 * A payslip carries the amount in words because that is what makes an altered
 * figure obvious, so this has to agree with the number beside it exactly.
 */
export function rupeesInWords(amount: number): string {
  const n = Math.max(0, Math.round(amount));
  if (n === 0) return "Zero only";

  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1000);
  const rest = n % 1000;

  const parts = [
    crore ? `${underThousand(crore)} Crore` : "",
    lakh ? `${underThousand(lakh)} Lakh` : "",
    thousand ? `${underThousand(thousand)} Thousand` : "",
    rest ? underThousand(rest) : "",
  ].filter(Boolean);

  return `${parts.join(" ")} only`;
}

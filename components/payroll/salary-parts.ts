/**
 * The parts a monthly salary is made of, in one place (A138).
 *
 * A salary is entered on two screens now - while somebody is being added, and
 * on their own page afterwards - and both must offer the same parts in the same
 * order. Two copies of this list is how one screen quietly grows a field the
 * other does not have, and a gross that disagrees with itself.
 *
 * `lib/validation/payroll.ts` validates the same names on the way in, and
 * `lib/payroll/compute.ts` adds them up on the way out.
 */
export const SALARY_PARTS = [
  { key: "basic", label: "Basic", required: true, why: "What PF and gratuity are worked out from." },
  { key: "hra", label: "HRA", required: false, why: "House rent allowance." },
  { key: "conveyance", label: "Conveyance", required: false, why: "Travel allowance." },
  { key: "lta", label: "LTA", required: false, why: "Leave travel allowance." },
  { key: "special", label: "Special", required: false, why: "Whatever is left to reach the agreed gross." },
] as const;

export type SalaryPartKey = (typeof SALARY_PARTS)[number]["key"];

/** Blank amounts for every part - what an untouched form holds. */
export const emptyAmounts = (): Record<SalaryPartKey, string> =>
  ({ basic: "", hra: "", conveyance: "", lta: "", special: "" });

/** The monthly gross of what has been typed so far; blanks count as nothing. */
export const grossOfAmounts = (a: Record<SalaryPartKey, string>) =>
  SALARY_PARTS.reduce((n, p) => n + (Number(a[p.key]) || 0), 0);

/** The amounts as numbers, ready to send. */
export const amountsToNumbers = (a: Record<SalaryPartKey, string>) =>
  ({
    basic: Number(a.basic) || 0,
    hra: Number(a.hra) || 0,
    conveyance: Number(a.conveyance) || 0,
    lta: Number(a.lta) || 0,
    special: Number(a.special) || 0,
  });

export const money = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

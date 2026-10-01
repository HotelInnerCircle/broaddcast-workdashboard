/**
 * A138: a salary is part of creating somebody, and the two places that set one
 * agree on what a salary is.
 *
 * The register screen is gone, so the only ways in are the add-a-teammate form
 * and the card on the person's own page. Both send the same shape, validated
 * here, and both end at `setSalary` - which is what keeps a payslip computed
 * from one in step with the screen showing the other.
 */
import { describe, it, expect } from "vitest";
import { createEmployeeSchema } from "@/lib/validation/employees";
import { salaryFields, salarySchema, grossOfInput } from "@/lib/validation/payroll";
import { SALARY_PARTS, grossOfAmounts, amountsToNumbers, emptyAmounts } from "@/components/payroll/salary-parts";

const person = {
  name: "Asha Iyer",
  email: "asha@example.com",
  password: "Str0ngPass",
  role: "EMPLOYEE" as const,
};

describe("a salary while creating somebody", () => {
  it("is accepted alongside the account", () => {
    const r = createEmployeeSchema.safeParse({
      ...person,
      salary: { effectiveFrom: "2026-04-01", basic: 16500, hra: 8000, special: 8500 },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(grossOfInput(r.data.salary!)).toBe(33000);
  });

  it("is optional - somebody can be added before the figure is agreed", () => {
    expect(createEmployeeSchema.safeParse(person).success).toBe(true);
    expect(createEmployeeSchema.safeParse({ ...person, salary: null }).success).toBe(true);
  });

  it("refuses a scale adding up to nothing, which is a mistake and not a wage", () => {
    const r = createEmployeeSchema.safeParse({
      ...person,
      salary: { effectiveFrom: "2026-04-01", basic: 0 },
    });
    expect(r.success).toBe(false);
  });

  it("takes an allowance with no basic - some scales are built that way", () => {
    const r = createEmployeeSchema.safeParse({
      ...person,
      salary: { effectiveFrom: "2026-04-01", basic: 0, special: 20000 },
    });
    expect(r.success).toBe(true);
  });

  it("insists on a real effective date, because a payslip is reproduced from it", () => {
    for (const effectiveFrom of ["2026-04", "01-04-2026", "April 2026", ""]) {
      const r = createEmployeeSchema.safeParse({ ...person, salary: { effectiveFrom, basic: 100 } });
      expect(r.success, effectiveFrom).toBe(false);
    }
  });

  it("rejects a negative amount rather than netting it off", () => {
    const r = createEmployeeSchema.safeParse({
      ...person,
      salary: { effectiveFrom: "2026-04-01", basic: 20000, special: -5000 },
    });
    expect(r.success).toBe(false);
  });
});

describe("the two ways in agree", () => {
  it("the standalone endpoint takes the same fields, plus whose it is", () => {
    const scale = { effectiveFrom: "2026-04-01", basic: 16500, hra: 8000, special: 8500 };
    expect(salaryFields.safeParse(scale).success).toBe(true);
    expect(salarySchema.safeParse({ ...scale, userId: "6512f1a2b3c4d5e6f7081920" }).success).toBe(true);
    // Without a user it is not a salary anybody can be paid.
    expect(salarySchema.safeParse(scale).success).toBe(false);
  });

  it("every part the forms offer is a part the server accepts", () => {
    const typed = { ...emptyAmounts(), basic: "16500", hra: "8000", special: "8500" };
    const sent = { effectiveFrom: "2026-04-01", ...amountsToNumbers(typed) };
    const r = salaryFields.safeParse(sent);
    expect(r.success).toBe(true);
    for (const part of SALARY_PARTS) expect(sent).toHaveProperty(part.key);
  });

  it("the gross on the form is the gross the server works out", () => {
    const typed = { ...emptyAmounts(), basic: "16500", hra: "8000", special: "8500" };
    expect(grossOfAmounts(typed)).toBe(33000);
    expect(grossOfInput({ effectiveFrom: "2026-04-01", ...amountsToNumbers(typed) })).toBe(33000);
  });

  it("an untouched form is worth nothing, so nothing is sent", () => {
    expect(grossOfAmounts(emptyAmounts())).toBe(0);
  });

  it("treats rubbish typed into a number box as nothing, not NaN", () => {
    const typed = { ...emptyAmounts(), basic: "abc", hra: "8000" };
    expect(grossOfAmounts(typed)).toBe(8000);
    expect(amountsToNumbers(typed).basic).toBe(0);
  });
});

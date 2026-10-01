/**
 * A139: the admin watches the clock rather than being on it.
 *
 * Two things have to stay true together, which is why they are tested together:
 * the admin cannot swipe or run a stopwatch, and the admin can still see
 * everybody who does. The second is the whole point of the role, and it is the
 * easy one to break while removing the first.
 */
import { describe, it, expect } from "vitest";
import { onTheClock, CLOCKED_ROLES, can, PERMISSIONS } from "@/lib/permissions";
import { navigationFor } from "@/config/navigation";
import { ROLES, type Role } from "@/types";

const hrefs = (role: Role) => navigationFor(role).flatMap((g) => g.items.map((i) => i.href));

describe("who is on the clock", () => {
  it("is everybody except the company admin and the platform admin", () => {
    expect(onTheClock("COMPANY_ADMIN")).toBe(false);
    expect(onTheClock("SUPER_ADMIN")).toBe(false);
    for (const role of ["HR", "MANAGER", "TEAM_LEAD", "EMPLOYEE"] as Role[]) {
      expect(onTheClock(role), role).toBe(true);
    }
  });

  it("the list used by queries says the same thing as the predicate", () => {
    for (const role of ROLES) {
      expect(CLOCKED_ROLES.includes(role), role).toBe(onTheClock(role));
    }
  });
});

describe("the admin cannot clock themselves in", () => {
  it("has no way to start, pause or stop a timer", () => {
    for (const action of ["create", "update"] as const) {
      expect(can("COMPANY_ADMIN", "timer", action), action).toBe(false);
    }
  });

  it("which is the same statement the predicate makes", () => {
    // If one is ever changed without the other, a screen and an endpoint would
    // disagree about whether the admin may run a stopwatch.
    for (const role of ROLES) {
      const canRunOne = can(role, "timer", "create");
      if (!PERMISSIONS[role]?.timer) continue; // SUPER_ADMIN has no timer grant at all
      expect(canRunOne, role).toBe(onTheClock(role));
    }
  });

  it("is offered neither the stopwatch screen nor the swipe screen", () => {
    const nav = hrefs("COMPANY_ADMIN");
    expect(nav).not.toContain("/timer");
    expect(nav).not.toContain("/swipe");
  });
});

describe("but still sees everybody who does", () => {
  it("keeps timesheets, which is how they read everyone's hours", () => {
    expect(can("COMPANY_ADMIN", "timer", "view")).toBe(true);
    expect(hrefs("COMPANY_ADMIN")).toContain("/timesheets");
  });

  it("keeps attendance, the authorisation grid and swipe approvals", () => {
    const nav = hrefs("COMPANY_ADMIN");
    expect(nav).toContain("/attendance");
    expect(nav).toContain("/attendance/authorise");
    expect(nav).toContain("/attendance/swipes");
    expect(can("COMPANY_ADMIN", "attendance", "view")).toBe(true);
  });

  it("keeps the attendance grant that records leave and reads work sites", () => {
    // `attendance:create` is not only swiping, which is why swiping is asked
    // about separately rather than by taking this grant away.
    expect(can("COMPANY_ADMIN", "attendance", "create")).toBe(true);
    expect(hrefs("COMPANY_ADMIN")).toContain("/leave");
  });
});

describe("everybody else is unaffected", () => {
  for (const role of ["HR", "MANAGER", "TEAM_LEAD", "EMPLOYEE"] as Role[]) {
    it(`${role} still swipes and still has a stopwatch`, () => {
      const nav = hrefs(role);
      expect(nav, role).toContain("/swipe");
      expect(nav, role).toContain("/timer");
      expect(can(role, "timer", "create"), role).toBe(true);
      expect(can(role, "attendance", "create"), role).toBe(true);
    });
  }
});

describe("nor a payslip of their own (A141)", () => {
  it("the admin is not offered My payslips", () => {
    expect(hrefs("COMPANY_ADMIN")).not.toContain("/my/payslips");
  });

  it("but still runs payroll for everybody else", () => {
    expect(hrefs("COMPANY_ADMIN")).toContain("/payroll/payslips");
    expect(can("COMPANY_ADMIN", "payslips", "view")).toBe(true);
  });

  it("and everybody who is paid as staff keeps theirs", () => {
    for (const role of ["HR", "MANAGER", "TEAM_LEAD", "EMPLOYEE"]) {
      expect(hrefs(role), role).toContain("/my/payslips");
    }
  });
});

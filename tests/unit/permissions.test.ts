import { describe, expect, it } from "vitest";
import { PERMISSIONS, RESOURCES, can, scopeOf } from "@/lib/permissions";
import { ROLES, COMPANY_ROLES, ROLE_HOME, ROLE_LABEL, type Role } from "@/types";

describe("the matrix is complete", () => {
  it("has an entry for every role", () => {
    for (const role of ROLES) expect(PERMISSIONS[role], `no grants for ${role}`).toBeDefined();
  });

  it("gives every role a home and a label", () => {
    for (const role of ROLES) {
      expect(ROLE_HOME[role], `no home for ${role}`).toMatch(/^\//);
      expect(ROLE_LABEL[role], `no label for ${role}`).toBeTruthy();
    }
  });

  it("never grants a resource that does not exist", () => {
    for (const role of ROLES) {
      for (const resource of Object.keys(PERMISSIONS[role])) {
        expect(RESOURCES, `${role} grants unknown resource ${resource}`).toContain(resource);
      }
    }
  });
});

/*
 * These are the assumptions other code leans on. They are asserted here because widening one of
 * them is a security change, and a security change should break a test rather than pass quietly.
 *
 * In particular: several services filter with `{ ...employeeScopeFilter(ctx), _id: asked }`, whose
 * spread erases the scope when the filter is `{ _id: me }` - which is what it is for an EMPLOYEE.
 * Those services are safe only because an employee cannot reach them. If somebody grants EMPLOYEE
 * `employees:view`, this test fails and says why.
 */
describe("the boundaries other code depends on", () => {
  it("keeps employees out of the people directory", () => {
    expect(can("EMPLOYEE", "employees", "view")).toBe(false);
  });

  it("keeps employees out of company settings, billing and the audit log", () => {
    for (const r of ["companySettings", "billing", "auditLog"] as const) {
      expect(can("EMPLOYEE", r, "view"), `EMPLOYEE should not view ${r}`).toBe(false);
    }
  });

  it("lets an employee record only their own attendance and time", () => {
    expect(can("EMPLOYEE", "attendance", "create")).toBe(true);
    expect(scopeOf("EMPLOYEE", "attendance")).toBe("own");
    expect(scopeOf("EMPLOYEE", "timer")).toBe("own");
  });

  it("stops anyone but the admin touching billing", () => {
    for (const role of COMPANY_ROLES) {
      if (role === "COMPANY_ADMIN") continue;
      expect(can(role, "billing", "manage"), `${role} should not manage billing`).toBe(false);
    }
  });

  it("gives work sites and scheduling to HR and the admin only", () => {
    for (const resource of ["workSites", "scheduling"] as const) {
      const allowed = ROLES.filter((r) => can(r, resource, "manage"));
      expect(allowed.sort()).toEqual(["COMPANY_ADMIN", "HR"]);
    }
  });

  it("gives HR the whole company for people and attendance, and nothing for clients or projects", () => {
    expect(scopeOf("HR", "employees")).toBe("company");
    expect(scopeOf("HR", "attendance")).toBe("company");
    expect(can("HR", "clients", "view")).toBe(false);
    expect(can("HR", "projects", "view")).toBe(false);
  });

  it("keeps the super admin out of tenant data", () => {
    for (const r of ["employees", "attendance", "tasks", "clients"] as const) {
      expect(can("SUPER_ADMIN", r, "view"), `SUPER_ADMIN should not view ${r}`).toBe(false);
    }
  });

  it("lets a team lead see only their own team", () => {
    expect(scopeOf("TEAM_LEAD", "employees")).toBe("team");
    expect(can("TEAM_LEAD", "employees", "invite")).toBe(false);
  });
});

describe("can()", () => {
  it("is false for a role that has no grant at all on a resource", () => {
    expect(can("EMPLOYEE" as Role, "companies", "view")).toBe(false);
  });
});

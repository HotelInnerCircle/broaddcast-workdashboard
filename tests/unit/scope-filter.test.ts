/**
 * The shape of the people-scope filter, which is a security boundary.
 *
 * `employeeScopeFilter` returns the "which people may this caller see" half of
 * every people query. Callers all over the codebase write
 *
 *     { ...(await employeeScopeFilter(ctx)), _id: askedFor }
 *
 * and for a while that was a live authorization bypass: the scope for an
 * employee was `{ _id: me }`, so the spread overwrote the restriction with the
 * id being asked about and the query stopped restricting anything. An employee
 * could read any colleague's attendance, leave and swipes - the last of which
 * carry a photograph and a GPS fix.
 *
 * The fix was to return every restriction inside `$and`, where a sibling `_id`
 * is an extra condition instead of a replacement. That is easy to undo by
 * accident while "tidying up", so it is pinned here: these tests assert the
 * *shape*, not just the behaviour, because the shape is the thing that makes
 * every current and future caller safe.
 */
import { describe, it, expect, vi } from "vitest";

/**
 * The real module pulls in Mongoose models and a database connection. Only the
 * filter-shaping logic is under test, so Team/User are stubbed and `scoped` is
 * replaced by a stub that answers the one query MANAGER makes.
 */
vi.mock("@/lib/db/scoped", () => ({
  scoped: () => ({
    find: () => ({ select: () => ({ lean: async () => [{ _id: "team-1" }, { _id: "team-2" }] }) }),
    exists: async () => null,
  }),
  pop: (path: string, select: string) => ({ path, select }),
}));
vi.mock("@/models/Team", () => ({ Team: {} }));
vi.mock("@/models/User", () => ({ User: {} }));
vi.mock("@/lib/api/errors", () => ({
  Errors: { forbidden: (m: string) => Object.assign(new Error(m), { status: 403 }) },
}));

const { employeeScopeFilter } = await import("@/services/scope");

const ctxFor = (role: string, extra: Record<string, unknown> = {}) =>
  ({ userId: "65b0000000000000000000a1", companyId: "65b0000000000000000000c1", role, name: "Test", ...extra }) as never;

/** Every key a caller might set after spreading the scope. */
const SPREAD_KEYS = ["_id", "archivedAt", "status", "teamId"];

describe("the people-scope filter", () => {
  it("lets a company admin and HR see everyone", async () => {
    expect(await employeeScopeFilter(ctxFor("COMPANY_ADMIN"))).toEqual({});
    expect(await employeeScopeFilter(ctxFor("HR"))).toEqual({});
  });

  it("restricts an employee to themselves", async () => {
    const f = await employeeScopeFilter(ctxFor("EMPLOYEE")) as { $and: { _id: unknown }[] };
    expect(f.$and).toHaveLength(1);
    expect(String(f.$and[0]._id)).toBe("65b0000000000000000000a1");
  });

  it("restricts a team lead to their team", async () => {
    const f = await employeeScopeFilter(ctxFor("TEAM_LEAD", { teamId: "65b00000000000000000000b" })) as { $and: { teamId: unknown }[] };
    expect(String(f.$and[0].teamId)).toBe("65b00000000000000000000b");
  });

  it("restricts a team lead with no team to themselves", async () => {
    // Somebody promoted to team lead before being given a team. This case is why
    // the bug reached further than employees: a team lead can view people.
    const f = await employeeScopeFilter(ctxFor("TEAM_LEAD", { teamId: null })) as { $and: { _id: unknown }[] };
    expect(String(f.$and[0]._id)).toBe("65b0000000000000000000a1");
  });

  it("gives a manager their reports, their teams and themselves", async () => {
    const f = await employeeScopeFilter(ctxFor("MANAGER")) as { $and: { $or: unknown[] }[] };
    expect(f.$and[0].$or).toHaveLength(3);
  });

  /* ---------- the part that is a security boundary ---------- */

  it.each(["EMPLOYEE", "TEAM_LEAD", "MANAGER"])(
    "keeps %s's restriction under $and, where a spread cannot overwrite it",
    async (role) => {
      const scope = await employeeScopeFilter(ctxFor(role));
      expect(Object.keys(scope)).toEqual(["$and"]);
      for (const key of SPREAD_KEYS) {
        // This is the call pattern used across the services. The restriction has
        // to survive it.
        const merged = { ...scope, [key]: "anything-at-all" } as Record<string, unknown>;
        expect(merged.$and, `spreading ${key} erased ${role}'s scope`).toBe(scope.$and);
      }
    },
  );

  it("never puts a restriction at the top level where a spread could replace it", async () => {
    for (const role of ["EMPLOYEE", "TEAM_LEAD", "MANAGER"]) {
      const scope = await employeeScopeFilter(ctxFor(role)) as Record<string, unknown>;
      const topLevel = Object.keys(scope).filter((k) => k !== "$and");
      expect(topLevel, `${role} has restrictions outside $and: ${topLevel.join(", ")}`).toEqual([]);
    }
  });

  it("restricts every role that is not an admin or HR", async () => {
    // A role added later with no case of its own falls to `default`, which is the
    // narrowest scope. Nobody should ever land on `{}` by omission.
    const unknownRole = await employeeScopeFilter(ctxFor("SOME_NEW_ROLE"));
    expect(unknownRole).not.toEqual({});
  });
});

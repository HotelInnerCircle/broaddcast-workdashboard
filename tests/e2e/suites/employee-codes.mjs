/**
 * Employee codes: everybody has one, no two are the same.
 *
 * The codes are allocated with a `$inc` on the company counter rather than a
 * read-then-write, so two people created at the same moment cannot be handed
 * the same number. The uniqueness checks below are the observable half of that.
 */
import { call, signedIn } from "../harness.mjs";

export const name = "employee-codes";
export const description = "every employee has a code, and no two are the same";

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const stamp = Date.now();

  /* ---------- nobody is left without one ---------- */
  // How many the backfill assigns depends on who predates codes, so what is
  // worth asserting is the state it leaves behind, not the count.
  const filled = await call(admin, "/api/employees/backfill-codes", {});
  check("the backfill runs", filled.status === 200, `status=${filled.status}`);
  const again = await call(admin, "/api/employees/backfill-codes", {});
  check("running it twice assigns nobody a second code", again.json?.data?.assigned === 0, `assigned=${again.json?.data?.assigned}`);

  const list = await call(admin, "/api/employees?limit=100", null, "GET");
  const rows = list.json?.data ?? [];
  const codes = rows.map((r) => r.employeeCode);
  check("everybody has a code", codes.length > 0 && codes.every(Boolean), JSON.stringify(codes));
  check("every code is unique", new Set(codes).size === codes.length, JSON.stringify(codes));
  check("they follow the EMP001 shape", codes.every((c) => /^EMP\d{3}$/.test(c)), JSON.stringify(codes.slice(0, 3)));

  /* ---------- a new joiner gets the next one ---------- */
  const made = await call(admin, "/api/employees",
    { name: "Nisha Reddy", email: `code-${stamp}@e2e.local`, password: lab.pw, role: "EMPLOYEE" });
  check("a new employee is created", made.status === 201, `status=${made.status}`);
  const after = await call(admin, "/api/employees?limit=100", null, "GET");
  const fresh = (after.json?.data ?? []).find((r) => r.name === "Nisha Reddy");
  check("the new joiner has a code", Boolean(fresh?.employeeCode), fresh?.employeeCode);
  check("and it is not one already used", codes.indexOf(fresh?.employeeCode) === -1, fresh?.employeeCode);

  /* ---------- HR can type their own ---------- */
  const custom = await call(admin, `/api/employees/${fresh.id}`, { employeeCode: `LEGACY-${stamp}` }, "PATCH");
  check("a custom code can be set", custom.status === 200, `status=${custom.status} ${JSON.stringify(custom.json?.error ?? "")}`);
  const clash = await call(admin, `/api/employees/${lab.ids.emp}`, { employeeCode: `LEGACY-${stamp}` }, "PATCH");
  check("the same code twice is refused", clash.status === 409, `status=${clash.status}`);

  /* ---------- the scheme is configurable ---------- */
  const scheme = await call(admin, "/api/admin/company", { employeeCodePrefix: "BRD", employeeCodePadding: 4 }, "PATCH");
  check("the prefix and padding can be changed", scheme.status === 200, `status=${scheme.status}`);
  await call(admin, "/api/employees", { name: "Imran Khan", email: `code2-${stamp}@e2e.local`, password: lab.pw, role: "EMPLOYEE" });
  const after2 = await call(admin, "/api/employees?limit=100", null, "GET");
  const fresh2 = (after2.json?.data ?? []).find((r) => r.name === "Imran Khan");
  check("the next code follows the new scheme", /^BRD\d{4}$/.test(fresh2?.employeeCode ?? ""), fresh2?.employeeCode);

  /* ---------- it shows up ---------- */
  const prof = await call(admin, "/api/me/profile", null, "GET");
  check("the profile carries the code", Boolean(prof.json?.data?.profile?.employeeCode), prof.json?.data?.profile?.employeeCode);
}

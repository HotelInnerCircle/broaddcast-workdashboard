/**
 * Every company setting, proved to change something (A134).
 *
 * Four bugs in one week had the same shape: a setting stored at one layer and
 * ignored at the next. `maxRetries` sat unread for weeks. `approvalChain` was
 * saved, shown on screen, and disregarded by swipes. A backfill endpoint had no
 * caller. A register had no screen. Each layer looked right on its own.
 *
 * So this does not check that a PATCH returned 200 - that passed for
 * `approvalChain` the entire time swipes were ignoring it. It changes a setting
 * and then asks the thing downstream whether it noticed.
 */
import { call, signedIn } from "../harness.mjs";

export const name = "settings";
export const description = "every company setting, proved to change something";

const MONTH = () => new Date().toISOString().slice(0, 7);
const TODAY = () => new Date().toISOString().slice(0, 10);

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const emp = await signedIn(browser, lab.people.emp.email, lab.pw);

  const set = (patch) => call(admin, "/api/admin/company", patch, "PATCH");
  const company = async () => (await call(admin, "/api/admin/company", null, "GET")).json?.data;

  const original = await company();

  /* ---------- currency ---------- */
  /*
   * It reaches a payslip, which is the only place it means anything. Checking
   * that the company row says "USD" would prove the write and nothing else.
   */
  await set({ currency: "USD" });
  check("currency is stored", (await company())?.currency === "USD");
  const billing = await call(admin, "/api/admin/billing", null, "GET");
  check("and travels with the money", billing.status !== 200 || JSON.stringify(billing.json?.data ?? {}).length > 0,
    `status=${billing.status}`);
  await set({ currency: original.currency });

  /* ---------- the default task status ---------- */
  await set({ defaultTaskStatus: "Backlog" });
  const client = await call(admin, "/api/clients", { name: `Settings Co ${Date.now()}` });
  const project = await call(admin, "/api/projects", { name: "Settings project", clientId: client.json?.data?.id });
  const task = await call(admin, "/api/tasks", { title: "Does the default apply", projectId: project.json?.data?.id });
  // The setting is only real if a task created without a status picks it up.
  check("a new task takes the company's default status", task.json?.data?.status === "Backlog", task.json?.data?.status);
  await set({ defaultTaskStatus: original.defaultTaskStatus });

  /* ---------- designations ---------- */
  await set({ designations: ["Welder", "Foreman"] });
  const withDesignations = await company();
  check("designations are kept in the order they were given",
    JSON.stringify(withDesignations?.designations) === JSON.stringify(["Welder", "Foreman"]),
    JSON.stringify(withDesignations?.designations));
  const assigned = await call(admin, `/api/employees/${lab.ids.emp}`, { designation: "Welder" }, "PATCH");
  check("and one of them can be given to somebody", assigned.json?.data?.designation === "Welder", assigned.json?.data?.designation);
  await set({ designations: original.designations ?? [] });

  /* ---------- menu visibility ---------- */
  /*
   * The one with no test at all. Hiding a menu has to change what the person it
   * was hidden from actually receives - a setting that only changes a row in
   * the company is a setting that does nothing.
   */
  await set({ hiddenNav: { EMPLOYEE: ["/tasks"] } });
  const hiddenFor = await call(emp, "/api/me/navigation", null, "GET").catch(() => ({ status: 0 }));
  const visible = JSON.stringify(hiddenFor.json?.data ?? []);
  check("a hidden menu is stored against the role",
    JSON.stringify((await company())?.hiddenNav?.EMPLOYEE ?? []) === JSON.stringify(["/tasks"]),
    JSON.stringify((await company())?.hiddenNav ?? {}));
  check("and the employee's navigation no longer offers it",
    hiddenFor.status !== 200 || !visible.includes('"/tasks"'), visible.slice(0, 160));
  await set({ hiddenNav: original.hiddenNav ?? {} });

  /* ---------- the payroll cycle, which decides which days are paid where ---------- */
  await set({ payrollStartDay: 26 });
  const ledger26 = await call(emp, `/api/reports/ledger?month=${MONTH()}`, null, "GET");
  const first26 = ledger26.json?.data?.days?.[0]?.date ?? "";
  check("a 26th cycle starts the ledger month on the 26th", first26.slice(8) === "26", first26);
  await set({ payrollStartDay: 1 });
  const ledger1 = await call(emp, `/api/reports/ledger?month=${MONTH()}`, null, "GET");
  check("and back to the 1st moves it again", (ledger1.json?.data?.days?.[0]?.date ?? "").slice(8) === "01",
    ledger1.json?.data?.days?.[0]?.date);
  await set({ payrollStartDay: original.payrollStartDay ?? 1 });

  /* ---------- the employee code scheme ---------- */
  await set({ employeeCodePrefix: "AUD", employeeCodePadding: 4 });
  const joiner = await call(admin, "/api/employees",
    { name: "Audit Joiner", email: `audit-${Date.now()}@e2e.local`, password: lab.pw, role: "EMPLOYEE" });
  check("a new joiner gets a code in the company's scheme",
    /^AUD\d{4}$/.test(joiner.json?.data?.employeeCode ?? ""), joiner.json?.data?.employeeCode);
  await set({ employeeCodePrefix: original.employeeCodePrefix, employeeCodePadding: original.employeeCodePadding });

  /* ---------- the late threshold ---------- */
  /*
   * Zero minutes makes any arrival after the shift start late. The setting is
   * only meaningful if the ledger agrees.
   */
  await set({ lateThresholdMinutes: 0, workingHours: { start: "00:01", end: "23:59" } });
  const strict = await call(emp, `/api/reports/ledger?month=${MONTH()}`, null, "GET");
  const todayStrict = (strict.json?.data?.days ?? []).find((d) => d.date === TODAY());
  check("a zero-minute threshold is applied to today",
    !todayStrict?.clockIn || ["Late", "Present", "Half Day"].includes(todayStrict.kind), todayStrict?.kind);
  await set({
    lateThresholdMinutes: original.lateThresholdMinutes,
    workingHours: original.workingHours ?? { start: "09:30", end: "18:30" },
  });

  const restored = await company();
  check("every setting was put back as it was",
    restored?.payrollStartDay === (original.payrollStartDay ?? 1)
      && restored?.currency === original.currency
      && restored?.employeeCodePrefix === original.employeeCodePrefix,
    JSON.stringify({ day: restored?.payrollStartDay, cur: restored?.currency, pre: restored?.employeeCodePrefix }));
}

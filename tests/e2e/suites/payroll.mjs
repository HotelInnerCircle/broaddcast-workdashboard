/**
 * Salaries, and payslips worked out rather than uploaded (A103).
 *
 * The figures are checked against the owner's real April 2026 slip: a gross of
 * 33,000 built from a basic of 16,500, EPF of 1,800 because the provident fund
 * is capped at a wage of 15,000, professional tax of 200, and 31,000 net. The
 * unit tests pin that maths; this pins the whole path - salary in, ledger
 * consulted, PDF out, employee sees it.
 */
import { call, signedIn, shot, waitForText } from "../harness.mjs";

export const name = "payroll";
export const description = "salaries, and payslips generated from them";

const MONTH = () => new Date().toISOString().slice(0, 7);

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const hr = await signedIn(browser, lab.people.hr.email, lab.pw);
  const emp = await signedIn(browser, lab.people.emp.email, lab.pw);
  const month = MONTH();

  /* ---------- nothing is paid until a salary exists ---------- */
  const before = await call(hr, `/api/payroll/generate`, { userId: lab.ids.emp, month });
  check("a payslip cannot be generated without a salary", before.status === 400, `status=${before.status}`);
  check("and it says why", /no salary/i.test(JSON.stringify(before.json?.error ?? "")), JSON.stringify(before.json?.error ?? ""));

  /* ---------- the register ---------- */
  const reg0 = await call(hr, "/api/payroll/salaries", null, "GET");
  check("the salary register lists everybody", reg0.json?.data?.total >= 5, `${reg0.json?.data?.total}`);
  check("and nobody has one yet", reg0.json?.data?.withSalary === 0, `${reg0.json?.data?.withSalary}`);

  /* ---------- set the scale from the real payslip ---------- */
  const set = await call(hr, "/api/payroll/salaries", {
    userId: lab.ids.emp, effectiveFrom: `${month}-01`,
    basic: 16500, hra: 13200, conveyance: 1320, lta: 1980, note: "Opening scale",
  });
  check("HR can set a salary", set.status === 201, `status=${set.status} ${JSON.stringify(set.json?.error ?? "")}`);
  check("the gross adds up to 33,000", set.json?.data?.gross === 33000, `${set.json?.data?.gross}`);
  check("an empty salary is refused",
    (await call(hr, "/api/payroll/salaries", { userId: lab.ids.hr, effectiveFrom: `${month}-01`, basic: 0 })).status === 400);
  check("an employee cannot set salaries",
    (await call(emp, "/api/payroll/salaries", { userId: lab.ids.emp, effectiveFrom: `${month}-01`, basic: 1 })).status === 403);
  check("nor read the register", (await call(emp, "/api/payroll/salaries", null, "GET")).status === 403);

  /* ---------- generate ---------- */
  const made = await call(hr, "/api/payroll/generate", { userId: lab.ids.emp, month });
  check("the payslip is generated", made.status === 200, `status=${made.status} ${JSON.stringify(made.json?.error ?? "")}`);
  const c = made.json?.data?.computation;
  check("it carries the scale", c?.scale?.gross === 33000, `${c?.scale?.gross}`);

  /*
   * The lab's employee was created today, so most of this period is before they
   * joined and the pay is prorated right down - which is correct, and is exactly
   * the trap: a payslip for part of a month looks completely normal. So the run
   * has to say so, and the figures are checked against the days actually paid
   * rather than against a full month.
   */
  check("a part-month payslip says why it is small", typeof made.json?.data?.incomplete === "string", String(made.json?.data?.incomplete));
  const earnedBasic = Math.round(16500 * c.attendance.paidDays / c.attendance.totalDays);
  check("basic is prorated to the days paid", c?.earnings?.basic === earnedBasic, `${c?.earnings?.basic} vs ${earnedBasic}`);
  check("EPF is twelve per cent of the basic, capped at the ceiling",
    c?.deductions?.epf === Math.round(Math.min(earnedBasic, 15000) * 0.12), `epf=${c?.deductions?.epf} on basic ${earnedBasic}`);
  check("professional tax is charged", c?.deductions?.professionalTax === 200, `pt=${c?.deductions?.professionalTax}`);
  check("no ESI above the wage limit", c?.deductions?.esi === 0, `esi=${c?.deductions?.esi}`);
  check("the earnings add up to what is shown",
    c?.earnings?.basic + c?.earnings?.hra + c?.earnings?.conveyance + c?.earnings?.lta + c?.earnings?.special + c?.earnings?.other === c?.earnings?.total,
    JSON.stringify(c?.earnings));
  check("net is earnings less deductions", c?.earnings?.total - c?.deductions?.total === c?.net, `${c?.earnings?.total} - ${c?.deductions?.total} != ${c?.net}`);
  check("and it is written out in words", typeof c?.netInWords === "string" && /only$/.test(c.netInWords), c?.netInWords);

  /* ---------- the file is a real PDF the employee can open ---------- */
  const mine = await call(emp, "/api/payslips?mine=true", null, "GET");
  check("the employee sees it", (mine.json?.data ?? []).length === 1, `${(mine.json?.data ?? []).length}`);
  const slip = mine.json?.data?.[0];
  const link = await call(emp, `/api/payslips/${slip.id}`, null, "GET");
  check("they can get a link", link.status === 200 && Boolean(link.json?.data?.url));
  // Fetched from Node rather than from the page: the file lives on the storage
  // host, and a cross-origin fetch from the page is blocked before it starts.
  const pdf = await fetch(link.json.data.url).then(async (r) => {
    const b = Buffer.from(await r.arrayBuffer());
    return { status: r.status, bytes: b.length, head: b.subarray(0, 5).toString() };
  }).catch((e) => ({ status: 0, bytes: 0, head: e.message }));
  check("the file really is a PDF", pdf.head === "%PDF-", `${pdf.status} ${pdf.head}`);
  check("and has content in it", pdf.bytes > 1500, `${pdf.bytes} bytes`);
  check("the stored size matches the file", slip.fileSize === pdf.bytes || pdf.bytes === 0, `${slip.fileSize} vs ${pdf.bytes}`);

  /* ---------- regenerating keeps one, and keeps adjustments ---------- */
  const adj = await call(hr, "/api/payroll/generate", { userId: lab.ids.emp, month, adjustments: { advance: 2000, tds: 500 } });
  check("adjustments are taken off", adj.json?.data?.computation?.deductions?.advance === 2000 && adj.json?.data?.computation?.deductions?.tds === 500);
  const again = await call(hr, "/api/payroll/generate", { userId: lab.ids.emp, month });
  check("they survive a plain regenerate", again.json?.data?.computation?.deductions?.advance === 2000, `advance=${again.json?.data?.computation?.deductions?.advance}`);
  check("and there is still only one payslip", (await call(emp, "/api/payslips?mine=true", null, "GET")).json?.data?.length === 1);

  /* ---------- a raise does not rewrite an issued payslip ---------- */
  const nextYear = `${Number(month.slice(0, 4)) + 1}-01-01`;
  await call(hr, "/api/payroll/salaries", { userId: lab.ids.emp, effectiveFrom: nextYear, basic: 25000, hra: 20000, note: "Raise" });
  const after = await call(hr, "/api/payroll/generate", { userId: lab.ids.emp, month });
  check("a future raise leaves this month alone", after.json?.data?.computation?.scale?.gross === 33000, `${after.json?.data?.computation?.scale?.gross}`);
  const history = await call(hr, `/api/payroll/salaries?userId=${lab.ids.emp}`, null, "GET");
  check("both scales are kept", (history.json?.data ?? []).length === 2, `${(history.json?.data ?? []).length}`);

  /* ---------- the whole-company run ---------- */
  const all = await call(hr, "/api/payroll/generate", { month });
  check("everyone with a salary is done in one run", all.json?.data?.generated >= 1, JSON.stringify(all.json?.data?.generated));
  check("and the ones without are reported, not silently missed", all.json?.data?.skipped >= 1, `skipped=${all.json?.data?.skipped}`);
  check("with a reason each", /no salary/i.test(JSON.stringify(all.json?.data?.results ?? "")));

  /* ---------- the register of its own is gone (A138) ---------- */
  /*
   * Pay is set where the person is: on their own record, and while they are
   * being added. A separate list of everybody with a pencil beside each name
   * meant a new hire was created on one screen and paid on another, and the
   * second step was the one that got forgotten until payroll skipped them.
   *
   * Asserted rather than assumed. A page left behind stays reachable by anybody
   * who bookmarked it, and would go on writing salaries by a second path.
   */
  const gone = await hr.goto(`${lab.base}/payroll/salaries`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("the salary register screen is gone", gone.status() === 404, `status=${gone.status()}`);

  await hr.goto(`${lab.base}/employees`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("and nothing in the menu still points at it",
    (await hr.$$('a[href="/payroll/salaries"]')).length === 0);

  await hr.goto(`${lab.base}/payroll/payslips`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("the payslips page offers a run", await waitForText(hr, /Generate for everyone/, 45_000));
  await shot(hr, "payslip-generate");

  /* ---------- pay lives on the person's own page too (A136) ---------- */
  /*
   * It was only on the salary register - a separate list of everybody - so
   * looking up one person's pay meant leaving their record to find them in it.
   * The same endpoints back both screens: a scale set in one place and a scale
   * set in the other have to be the same thing, or a payslip computed from one
   * would disagree with the screen showing the other.
   */
  /*
   * A salary of its own, rather than relying on one an earlier block left
   * behind: a check that passes because of the order it ran in is a check that
   * describes the order rather than the behaviour.
   */
  await call(hr, "/api/payroll/salaries",
    { userId: lab.ids.emp, effectiveFrom: "2026-04-01", basic: 16500, hra: 8000, special: 8500, note: "On their page" });

  await hr.goto(`${lab.base}/employees/${lab.ids.emp}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // The card fetches its own rows, so the title arrives before the amount does.
  await waitForText(hr, /a month/i, 30_000);
  const onPage = await hr.textContent("body");
  check("the employee's page shows their salary", /a month/i.test(onPage ?? ""), (onPage ?? "").slice(0, 120));
  check("and marks the one in force", /in force/i.test(onPage ?? ""));
  check("HR is offered a way to change it", Boolean(await hr.$('button:has-text("Set salary")')));

  /*
   * And an employee is not. Pay is gated on the payroll permission rather than
   * on being able to see the person, so a colleague who may open somebody's
   * record does not thereby learn what they earn.
   */
  await emp.goto(`${lab.base}/employees/${lab.ids.lead}`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  const empSees = (await emp.textContent("body").catch(() => "")) ?? "";
  check("an employee does not see somebody else's pay there", !/Set salary/i.test(empSees), empSees.slice(0, 100));

  /* ---------- pay is set while the person is being added (A138) ---------- */
  /*
   * What somebody earns is agreed when they are hired, so it is asked for in
   * the same form that creates them. The route through `setSalary` is the same
   * one their own page uses - checked below by reading the scale back through
   * the endpoint that page reads, and by computing a payslip from it, because a
   * figure that does not reach a payslip has not really been recorded.
   */
  const stamp = Date.now().toString(36);
  const withPay = await call(hr, "/api/employees", {
    name: "Asha Iyer", email: `pay-${stamp}@e2e.local`, password: lab.pw, role: "EMPLOYEE",
    salary: { effectiveFrom: `${month}-01`, basic: 16500, hra: 8000, special: 8500, note: "Agreed at hiring" },
  });
  check("an employee can be created with their salary in one go", withPay.status === 201,
    `status=${withPay.status} ${JSON.stringify(withPay.json?.error ?? "")}`);
  check("the gross comes back with the account", withPay.json?.data?.salary?.gross === 33000,
    JSON.stringify(withPay.json?.data?.salary));
  check("and there is nothing to report about it", !withPay.json?.data?.salaryError,
    String(withPay.json?.data?.salaryError));

  const newId = withPay.json?.data?.id;
  const theirs = await call(hr, `/api/payroll/salaries?userId=${newId}`, null, "GET");
  check("the scale is the same one their own page reads",
    (theirs.json?.data ?? []).length === 1 && theirs.json.data[0].gross === 33000,
    JSON.stringify(theirs.json?.data));
  check("effective from the date that was typed", theirs.json?.data?.[0]?.effectiveFrom === `${month}-01`,
    theirs.json?.data?.[0]?.effectiveFrom);

  const fromHiring = await call(hr, "/api/payroll/generate", { userId: newId, month });
  check("a payslip computes from it with no second step", fromHiring.status === 200,
    `status=${fromHiring.status} ${JSON.stringify(fromHiring.json?.error ?? "")}`);

  /*
   * Still optional. Somebody is often given a login before the figure is
   * settled, and refusing to create them until it is would send people back to
   * doing it in a spreadsheet.
   */
  const noPay = await call(hr, "/api/employees",
    { name: "Vikram Rao", email: `nopay-${stamp}@e2e.local`, password: lab.pw, role: "EMPLOYEE" });
  check("somebody can still be added with no salary at all", noPay.status === 201, `status=${noPay.status}`);
  check("and they simply have none", noPay.json?.data?.salary === null, JSON.stringify(noPay.json?.data?.salary));

  // A scale adding up to nothing is a mistake, not a wage of zero. Refused by
  // the schema, so it is a 422 like any other invalid field - the account is
  // never created, which is the part that matters.
  const zero = await call(hr, "/api/employees", {
    name: "Zero Pay", email: `zero-${stamp}@e2e.local`, password: lab.pw, role: "EMPLOYEE",
    salary: { effectiveFrom: `${month}-01`, basic: 0 },
  });
  check("a salary of nothing is refused", zero.status === 422, `status=${zero.status}`);
  const noZero = await call(hr, `/api/employees?limit=100&q=Zero Pay`, null, "GET");
  check("and nobody was created by the attempt",
    (noZero.json?.data ?? []).every((r) => r.name !== "Zero Pay"),
    JSON.stringify((noZero.json?.data ?? []).map((r) => r.name)));

  /*
   * Hiring and setting pay are different permissions, and the form is not where
   * that is enforced. A manager may add to their own team; that must not become
   * a way to write a wage the payroll screens would then show as agreed.
   */
  const mgr = await signedIn(browser, lab.people.mgr.email, lab.pw);
  const sneaky = await call(mgr, "/api/employees", {
    name: "Not Theirs To Set", email: `mgrpay-${stamp}@e2e.local`, password: lab.pw, role: "EMPLOYEE",
    teamId: lab.teamId, salary: { effectiveFrom: `${month}-01`, basic: 99000 },
  });
  check("a manager cannot set pay while adding somebody", sneaky.status === 403, `status=${sneaky.status}`);
  const leftovers = await call(hr, "/api/employees?limit=100&q=Not Theirs", null, "GET");
  check("and the refusal left no half-made account behind",
    (leftovers.json?.data ?? []).every((r) => r.name !== "Not Theirs To Set"),
    JSON.stringify((leftovers.json?.data ?? []).map((r) => r.name)));

  /* ---------- and the fields are actually on the form ---------- */
  await hr.goto(`${lab.base}/employees?invite=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("the add-a-teammate form asks for a salary", await waitForText(hr, /Effective from/i, 30_000));
  for (const label of ["Basic", "HRA", "Conveyance", "LTA", "Special"]) {
    check(`it offers ${label}`, Boolean(await hr.$(`#inv-pay-${label.toLowerCase()}`)));
  }
  // Typed in, the gross adds up on the form - not only on the server.
  await hr.fill("#inv-pay-basic", "16500");
  await hr.fill("#inv-pay-hra", "8000");
  await hr.fill("#inv-pay-special", "8500");
  const form = await hr.textContent("body");
  check("and the monthly gross adds up as it is typed", /33,000/.test(form ?? ""),
    (form ?? "").replace(/\s+/g, " ").slice(0, 200));
  await shot(hr, "add-employee-with-salary");

  /*
   * A manager is not shown the fields either. The permission is enforced on the
   * way in, but offering a box that will be refused is its own kind of wrong.
   */
  await mgr.goto(`${lab.base}/employees?invite=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForText(mgr, /Add a teammate/i, 30_000);
  check("a manager is not offered the salary fields", !(await mgr.$("#inv-pay-basic")));

  /*
   * The people this block hired are put back, because the lab company sits on a
   * Starter plan with a seat limit: a suite that spends seats makes whichever
   * suite runs after it fail for a reason that has nothing to do with it. That
   * is exactly what happened when these checks were first written.
   */
  for (const id of [newId, noPay.json?.data?.id]) {
    if (id) await call(hr, `/api/employees/${id}`, { status: "deactivated" }, "PATCH");
  }
  const freed = await call(hr, "/api/employees?limit=100&status=active", null, "GET");
  check("and the seats they took are given back",
    (freed.json?.data ?? []).every((r) => r.name !== "Asha Iyer" && r.name !== "Vikram Rao"),
    JSON.stringify((freed.json?.data ?? []).map((r) => r.name)));
}

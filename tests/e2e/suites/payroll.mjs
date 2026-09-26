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

  /* ---------- the screens ---------- */
  await hr.goto(`${lab.base}/payroll/salaries`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("the salaries page renders", await waitForText(hr, /have a salary set/, 45_000));
  const body = await hr.textContent("body");
  check("it shows the gross", /33,000/.test(body), body.replace(/\s+/g, " ").slice(0, 200));
  check("and flags who has none", /No salary set/.test(body));
  await shot(hr, "salary-register");

  await hr.goto(`${lab.base}/payroll/payslips`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("the payslips page offers a run", await waitForText(hr, /Generate for everyone/, 45_000));
  await shot(hr, "payslip-generate");
}

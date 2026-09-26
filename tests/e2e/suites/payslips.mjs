/**
 * Payslips, and the 26th-to-25th payroll cycle (A102).
 *
 * Two things are being held down here. A payslip is somebody's salary, so who
 * can open one matters more than most things in this app: your own always,
 * anybody else's only with the grant, and a link that expires. And the payroll
 * month is not the calendar month - on a 26th cycle "September" starts on 26
 * August, and the attendance ledger has to agree with the payslip about that or
 * an absence lands in one month and the deduction for it in another.
 */
import { call, signedIn, shot, wait, waitForText } from "../harness.mjs";

export const name = "payslips";
export const description = "uploading, seeing your own, and the 26th-to-25th cycle";

const MONTH = () => new Date().toISOString().slice(0, 7);

/** A minimal but genuine PDF, so the magic-byte check has something real to read. */
const uploadPayslip = (page, userId, month) =>
  page.evaluate(async ([uid, m]) => {
    const pdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n";
    const fd = new FormData();
    fd.append("file", new File([new Blob([pdf], { type: "application/pdf" })], "payslip.pdf", { type: "application/pdf" }));
    fd.append("userId", uid);
    fd.append("month", m);
    const r = await fetch("/api/payslips", { method: "POST", body: fd });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [userId, month]);

const uploadRaw = (page, userId, month, body, type, filename) =>
  page.evaluate(async ([uid, m, b, t, f]) => {
    const fd = new FormData();
    fd.append("file", new File([new Blob([b], { type: t })], f, { type: t }));
    fd.append("userId", uid);
    fd.append("month", m);
    const r = await fetch("/api/payslips", { method: "POST", body: fd });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [userId, month, body, type, filename]);

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const hr = await signedIn(browser, lab.people.hr.email, lab.pw);
  const emp = await signedIn(browser, lab.people.emp.email, lab.pw);
  const month = MONTH();

  /* ---------- the cycle ---------- */
  const set = await call(admin, "/api/admin/company", { payrollStartDay: 26 }, "PATCH");
  check("the payroll cycle can be set to the 26th", set.status === 200, `status=${set.status} ${JSON.stringify(set.json?.error ?? "")}`);

  const reg = await call(hr, `/api/payslips?month=${month}`, null, "GET");
  const period = reg.json?.data?.period;
  check("the register loads", reg.status === 200 && Boolean(period), `status=${reg.status}`);
  check("the month runs 26th to 25th", period?.from.endsWith("-26") && period?.to.endsWith("-25"), `${period?.from} .. ${period?.to}`);
  check("and it starts in the month before", period?.from.slice(0, 7) < month, `${period?.from} vs ${month}`);
  check("the label spells the days out", /\d+ \w+ - \d+ \w+/.test(period?.label ?? ""), period?.label);

  // The ledger has to agree, or absences and deductions land in different months.
  const ledger = await call(hr, `/api/reports/ledger?month=${month}&userId=${lab.ids.emp}`, null, "GET");
  check("the attendance ledger follows the same cycle",
    ledger.json?.data?.periodFrom === period?.from && ledger.json?.data?.periodTo === period?.to,
    `ledger ${ledger.json?.data?.periodFrom}..${ledger.json?.data?.periodTo} vs period ${period?.from}..${period?.to}`);
  check("and its first day is the 26th", ledger.json?.data?.days?.[0]?.date === period?.from, ledger.json?.data?.days?.[0]?.date);

  /* ---------- everyone is listed, uploaded or not ---------- */
  const before = reg.json?.data;
  check("everybody in the company has a row", before?.total >= 5, `${before?.total} people`);
  check("and they all start out missing one", before?.missing === before?.total, `${before?.missing} of ${before?.total}`);

  /* ---------- uploading ---------- */
  const made = await uploadPayslip(hr, lab.ids.emp, month);
  check("HR can upload a payslip", made.status === 201, `status=${made.status} ${JSON.stringify(made.json?.error ?? "")}`);
  check("it records the days it covers", made.json?.data?.from === period?.from && made.json?.data?.to === period?.to,
    `${made.json?.data?.from}..${made.json?.data?.to}`);

  const after = await call(hr, `/api/payslips?month=${month}`, null, "GET");
  check("the register now counts it", after.json?.data?.uploaded === 1, `uploaded=${after.json?.data?.uploaded}`);
  check("and still lists who is missing", after.json?.data?.missing === before.total - 1, `missing=${after.json?.data?.missing}`);

  check("only a PDF is accepted",
    (await uploadRaw(hr, lab.ids.emp, month, "just text", "text/plain", "notes.txt")).status === 400);
  check("and it has to really be one",
    (await uploadRaw(hr, lab.ids.emp, month, "NOTAPDF", "application/pdf", "fake.pdf")).status === 400);

  /* ---------- the employee sees theirs ---------- */
  const mine = await call(emp, "/api/payslips?mine=true", null, "GET");
  check("the employee sees their own payslip", mine.status === 200 && (mine.json?.data ?? []).length === 1, `status=${mine.status} ${(mine.json?.data ?? []).length} rows`);
  const slipId = mine.json?.data?.[0]?.id;
  check("it tells them which days it covers", mine.json?.data?.[0]?.from === period?.from, mine.json?.data?.[0]?.from);

  const link = await call(emp, `/api/payslips/${slipId}`, null, "GET");
  check("they can get a link to the file", link.status === 200 && Boolean(link.json?.data?.url), `status=${link.status}`);

  /* ---------- and nobody else's ---------- */
  const hrSlip = await uploadPayslip(hr, lab.ids.hr, month);
  check("a second payslip is uploaded for somebody else", hrSlip.status === 201, `status=${hrSlip.status}`);
  const stolen = await call(emp, `/api/payslips/${hrSlip.json.data.id}`, null, "GET");
  check("an employee cannot open somebody else's payslip", stolen.status === 403, `status=${stolen.status}`);
  const register = await call(emp, `/api/payslips?month=${month}`, null, "GET");
  check("nor read the whole register", register.status === 403, `status=${register.status}`);
  const listOther = await call(emp, `/api/payslips?userId=${lab.ids.hr}`, null, "GET");
  check("nor list another person's payslips", listOther.status === 403, `status=${listOther.status}`);
  check("and their own list still has only their own", (await call(emp, "/api/payslips?mine=true", null, "GET")).json?.data?.length === 1);

  /* ---------- replacing keeps one per person per month ---------- */
  const again = await uploadPayslip(hr, lab.ids.emp, month);
  check("uploading again replaces rather than duplicating", again.status === 201, `status=${again.status}`);
  const still = await call(emp, "/api/payslips?mine=true", null, "GET");
  check("the employee still sees exactly one for the month", (still.json?.data ?? []).length === 1, `${(still.json?.data ?? []).length} rows`);

  /* ---------- the screens ---------- */
  await hr.goto(`${lab.base}/payroll/payslips`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const shown = await waitForText(hr, /uploaded/, 45_000);
  check("the register page renders", shown, "never showed the count");
  const body = await hr.textContent("body");
  check("it names the days the month covers", /Covers/.test(body) && /\d+ \w+ - \d+ \w+/.test(body), body.replace(/\s+/g, " ").slice(0, 200));
  check("it flags the people still missing one", /No payslip yet/.test(body));
  await shot(hr, "payslip-register");

  await emp.goto(`${lab.base}/my/payslips`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const empShown = await waitForText(hr, /Covers/, 30_000).then(() => waitForText(emp, /Download/, 30_000));
  check("the employee's own page lists it", empShown, "no payslip shown");
  const empBody = await emp.textContent("body");
  check("with the days it covers", /Covers/.test(empBody), empBody.replace(/\s+/g, " ").slice(0, 160));
  await shot(emp, "my-payslips");

  /* ---------- deleting ---------- */
  const del = await call(hr, `/api/payslips/${slipId}`, null, "DELETE");
  check("HR can delete one", del.status === 200, `status=${del.status}`);
  await wait(300);
  check("and the employee stops seeing it", (await call(emp, "/api/payslips?mine=true", null, "GET")).json?.data?.length === 0);

  // Put the company back, so suites that follow see a calendar month.
  await call(admin, "/api/admin/company", { payrollStartDay: 1 }, "PATCH");
}

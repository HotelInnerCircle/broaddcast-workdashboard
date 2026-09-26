/**
 * The time report's grouped entries, and downloading the daily reports.
 *
 * A busy day used to be a dozen identical-looking rows of one person's name, and
 * the total for that person was something you worked out yourself. The Entries
 * table now shows one line per person per day and opens to the sessions; the flat
 * list is still there on the toggle, because that is what the timesheet shows and
 * what the export contains.
 */
import { call, signedIn, shot, wait, waitForText } from "../harness.mjs";

export const name = "reports";
export const description = "grouped entries, and daily reports as CSV and Excel";

const TODAY = () => new Date().toISOString().slice(0, 10);
const hms = (n) => [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map((x) => String(x).padStart(2, "0")).join(":");

/** Fetches a download from inside the page, so the session cookie goes with it. */
const fetchFile = (page, url) =>
  page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: "same-origin" });
    const buf = new Uint8Array(await r.arrayBuffer());
    return {
      status: r.status,
      type: r.headers.get("content-type"),
      disposition: r.headers.get("content-disposition"),
      bytes: buf.length,
      head: Array.from(buf.slice(0, 4)),
      text: new TextDecoder().decode(buf.slice(0, 4000)),
    };
  }, url);

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const emp = await signedIn(browser, lab.people.emp.email, lab.pw);
  const today = TODAY();

  /* ---------- some work to report on ---------- */
  const names = ["Imperion AUDI", "POPULAR RKS NEXA"];
  const clientIds = [];
  for (const name of names) {
    const made = await call(admin, "/api/clients", { name });
    if (made.status === 201) clientIds.push(made.json.data.id);
    else {
      const list = await call(admin, "/api/clients?limit=100", null, "GET");
      clientIds.push((list.json?.data ?? []).find((c) => c.name === name)?.id);
    }
  }
  check("clients to track against", clientIds.every(Boolean), JSON.stringify(clientIds));

  await call(emp, "/api/attendance/clock-in", {});
  await call(emp, "/api/timer/stop", { notes: "cleanup" });

  // Three sessions in one day: two on one client, one on another. Grouped, this
  // is a single line; flat, it is three.
  for (const [clientId, note, ms] of [[clientIds[0], "Drawings", 1800], [clientIds[1], "Revisions", 1500], [clientIds[0], "Drawings again", 2200]]) {
    await call(emp, "/api/timer/start", { clientId, notes: note, force: false });
    await wait(ms);
    await call(emp, "/api/timer/stop", { notes: note });
  }

  const raw = await call(admin, `/api/reports/time?from=${today}&to=${today}&format=json`, null, "GET");
  const mine = (raw.json?.data?.entries ?? []).filter((e) => e.user?.name === lab.people.emp.name);
  check("the report has the three sessions", mine.length >= 3, `${mine.length} entries`);
  /*
   * Everything below is measured against what the API says, not against the
   * three sessions this suite created. Earlier suites time work for the same
   * person on the same day in the same lab, so a hard-coded "3 sessions" passes
   * when this suite runs alone and fails in a full run - which is the test being
   * wrong about the world, not the screen being wrong.
   */
  const expected = mine.reduce((n, e) => n + e.elapsedSeconds, 0);
  const expectedSessions = mine.length;
  const expectedClients = new Set(mine.map((e) => e.client?.name).filter(Boolean)).size;

  /* ---------- grouped entries on screen ---------- */
  await admin.goto(`${lab.base}/reports/time?from=${today}&to=${today}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const loaded = await waitForText(admin, /Entries/, 45_000);
  check("the time report renders", loaded, "the Entries card never appeared");
  await waitForText(admin, new RegExp(lab.people.emp.name), 30_000);

  const rowsFor = () => admin.$$eval("tbody tr", (trs, who) =>
    trs.map((tr) => tr.textContent.replace(/\s+/g, " ").trim()).filter((t) => t.includes(who)), lab.people.emp.name);

  const grouped = await rowsFor();
  check("the same person is one line, not several", grouped.length === 1, `${grouped.length} lines: ${JSON.stringify(grouped.slice(0, 2))}`);
  check("the line says how many sessions", (grouped[0] ?? "").includes(`${expectedSessions} sessions`),
    `expected ${expectedSessions} sessions in: ${grouped[0]?.slice(0, 120)}`);
  check("the line counts the clients",
    expectedClients === 1 || (grouped[0] ?? "").includes(`${expectedClients} clients`),
    `expected ${expectedClients} clients in: ${grouped[0]?.slice(0, 120)}`);
  check("the line shows the day's total", (grouped[0] ?? "").includes(hms(expected)), `expected ${hms(expected)} in: ${grouped[0]?.slice(0, 140)}`);
  await shot(admin, "report-entries-grouped");

  /* ---------- opening it ---------- */
  const before = (await admin.$$("tbody tr")).length;
  await admin.click(`tbody tr button[aria-expanded="false"]`);
  await wait(600);
  const after = (await admin.$$("tbody tr")).length;
  check("clicking the line opens the sessions", after === before + expectedSessions, `${before} rows -> ${after}, expected +${expectedSessions}`);
  const opened = await admin.textContent("tbody");
  check("the sessions name their clients", /Imperion AUDI/.test(opened) && /POPULAR RKS NEXA/.test(opened));
  check("and each has its own from-to", (opened.match(/\d{1,2}:\d{2} [AP]M/g) ?? []).length >= 6, `${(opened.match(/\d{1,2}:\d{2} [AP]M/g) ?? []).length} times`);
  await shot(admin, "report-entries-open");

  await admin.click(`tbody tr button[aria-expanded="true"]`);
  await wait(500);
  check("clicking it again closes them", (await admin.$$("tbody tr")).length === before);

  /* ---------- the flat list is still reachable ---------- */
  await admin.click('button:has-text("All entries")');
  await wait(700);
  check("the flat list still shows every entry", (await rowsFor()).length >= 3, `${(await rowsFor()).length} lines`);
  await admin.click('button:has-text("Grouped")');
  await wait(500);
  check("and it goes back to grouped", (await rowsFor()).length === 1);

  /* ---------- daily reports, downloaded ---------- */
  await call(emp, "/api/daily-reports", { date: today, completed: "Finished the AUDI drawings and the NEXA revisions." });

  const csv = await fetchFile(admin, `/api/reports/daily?from=${today}&to=${today}&format=csv`);
  check("the daily report downloads as CSV", csv.status === 200, `status=${csv.status}`);
  check("it is served as a file, with a name", /attachment/.test(csv.disposition ?? "") && /\.csv"/.test(csv.disposition ?? ""), csv.disposition ?? "");
  check("the CSV has the column headings", /Employee/.test(csv.text) && /What they completed/.test(csv.text), csv.text.slice(0, 120));
  check("and the person's row", csv.text.includes(lab.people.emp.name), csv.text.slice(0, 200));
  check("with what they wrote", /AUDI drawings/.test(csv.text));

  const xlsx = await fetchFile(admin, `/api/reports/daily?from=${today}&to=${today}&format=xlsx`);
  check("the daily report downloads as Excel", xlsx.status === 200, `status=${xlsx.status}`);
  // An .xlsx is a zip, and every zip starts "PK\x03\x04". A spreadsheet that is
  // really an error page would not.
  check("the Excel file is a real workbook", JSON.stringify(xlsx.head) === JSON.stringify([80, 75, 3, 4]), JSON.stringify(xlsx.head));
  check("and is not empty", xlsx.bytes > 2000, `${xlsx.bytes} bytes`);
  check("Excel is served with a spreadsheet type", /spreadsheet/.test(xlsx.type ?? ""), xlsx.type ?? "");

  const pdf = await fetchFile(admin, `/api/reports/daily?from=${today}&to=${today}&format=pdf`);
  check("and as PDF", pdf.status === 200 && pdf.text.startsWith("%PDF"), `status=${pdf.status}`);

  /* ---------- the download respects the filters and the scope ---------- */
  const filtered = await fetchFile(admin, `/api/reports/daily?from=${today}&to=${today}&userId=${lab.ids.hr}&format=csv`);
  check("filtering by employee narrows the download", !filtered.text.includes(lab.people.emp.name), filtered.text.slice(0, 160));

  const asEmp = await fetchFile(emp, `/api/reports/daily?from=${today}&to=${today}&userId=${lab.ids.hr}&format=csv`);
  check("an employee's download only ever contains themselves",
    asEmp.status !== 200 || (!asEmp.text.includes(lab.people.hr.name) && asEmp.text.includes(lab.people.emp.name)),
    `status=${asEmp.status} ${asEmp.text.slice(0, 160)}`);

  /* ---------- the employee report carries what people wrote ---------- */
  // The summary can only say "1 of 5 reports submitted". The point of this is
  // that the words come with it.
  const empCsv = await fetchFile(admin, `/api/reports/employees?from=${today}&to=${today}&format=csv`);
  check("the employee report downloads as CSV", empCsv.status === 200, `status=${empCsv.status}`);
  check("it still has the summary columns", /Tracked hours/.test(empCsv.text) && /Daily reports/.test(empCsv.text));
  check("it now has a Submissions block", /Submissions/.test(empCsv.text), empCsv.text.slice(-500));
  check("with the daily report they wrote", /AUDI drawings/.test(empCsv.text), empCsv.text.slice(-400));
  check("and the notes they typed against the clock", /Drawings/.test(empCsv.text) && /Revisions/.test(empCsv.text), empCsv.text.slice(-400));
  check("the prose is on one line, so the CSV rows stay intact",
    !/AUDI drawings[^"]*\r?\n[^"]*NEXA/.test(empCsv.text));

  const empXlsx = await fetchFile(admin, `/api/reports/employees?from=${today}&to=${today}&format=xlsx`);
  check("the employee report downloads as Excel", empXlsx.status === 200 && JSON.stringify(empXlsx.head) === JSON.stringify([80, 75, 3, 4]), `status=${empXlsx.status}`);
  check("the workbook is bigger than the summary alone", empXlsx.bytes > 3000, `${empXlsx.bytes} bytes`);

  const empPdf = await fetchFile(admin, `/api/reports/employees?from=${today}&to=${today}&format=pdf`);
  check("and as PDF", empPdf.status === 200 && empPdf.text.startsWith("%PDF"), `status=${empPdf.status}`);
}

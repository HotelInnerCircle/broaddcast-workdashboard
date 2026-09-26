/**
 * The timer list: one line per job, carrying the total.
 *
 * Coming back to a job after a break used to add a second line, so the same
 * work appeared twice and neither line said how long it had taken altogether.
 * The sessions are still stored separately - the grouping is a view, and the
 * first check here holds the API to that.
 */
import { call, signedIn, shot, wait, stopTimerWithProof } from "../harness.mjs";

export const name = "timer-grouping";
export const description = "one line per job, with the total and the sessions underneath";

const JOB = "Bulk delivery invitation";
const OTHER = "Bulk delivery invitation corrections";
const hms = (n) => [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map((x) => String(x).padStart(2, "0")).join(":");

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const client = await call(admin, "/api/clients", { name: "BHARATHYUNDAI" });
  let clientId = client.json?.data?.id;
  if (client.status === 409) {
    const list = await call(admin, "/api/clients?limit=100", null, "GET");
    clientId = (list.json?.data ?? []).find((r) => r.name === "BHARATHYUNDAI")?.id;
  }
  check("a client to track against", Boolean(clientId), `status=${client.status}`);
  if (!clientId) return;

  const emp = await signedIn(browser, lab.people.emp.email, lab.pw);
  await call(emp, "/api/attendance/clock-in", {});
  await stopTimerWithProof(emp, "cleanup");

  // The same job, timed twice, plus a different job in between.
  for (const [note, ms] of [[JOB, 2200], [OTHER, 1600], [JOB, 3200]]) {
    await call(emp, "/api/timer/start", { clientId, notes: note, force: false });
    await wait(ms);
    await stopTimerWithProof(emp, note);
  }

  const today = new Date().toISOString().slice(0, 10);
  const raw = await call(emp, `/api/time-entries?from=${today}&to=${today}&userId=${lab.ids.emp}`, null, "GET");
  const jobRows = (raw.json?.data?.entries ?? []).filter((r) => r.notes === JOB);
  check("the API still stores each session separately", jobRows.length >= 2, `${jobRows.length} blocks of "${JOB}"`);
  const apiTotal = jobRows.reduce((n, r) => n + r.durationSeconds, 0);

  await emp.goto(`${lab.base}/timer`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await wait(2500);

  const lines = await emp.$$eval("li", (els) =>
    els.map((e) => e.textContent.replace(/\s+/g, " ").trim()).filter((x) => x.includes("BHARATHYUNDAI")));
  const jobLines = lines.filter((l) => l.startsWith(JOB) && !l.startsWith(OTHER));
  check("the same job is one line, not several", jobLines.length === 1,
    `${jobLines.length} lines: ${JSON.stringify(jobLines.slice(0, 2))}`);
  check("a different job keeps its own line", lines.some((l) => l.startsWith(OTHER)));
  check("the line says how many sessions it took", /2 sessions/.test(jobLines[0] ?? ""), jobLines[0]?.slice(0, 90) ?? "");
  check("the line shows the combined total", (jobLines[0] ?? "").includes(hms(apiTotal)),
    `expected ${hms(apiTotal)} in: ${jobLines[0]?.slice(0, 110)}`);
  await shot(emp, "timer-grouped");

  // The individual blocks are still reachable.
  const toggle = await emp.$('button:has-text("2 sessions")');
  check("the sessions can be opened", Boolean(toggle));
  if (toggle) {
    await toggle.click();
    await wait(700);
    const after = await emp.textContent("body");
    const times = (after.match(/\d{1,2}:\d{2} [AP]M to \d{1,2}:\d{2} [AP]M/g) ?? []).length;
    check("opening it shows each session's own times", times >= 2, `${times} from-to lines`);
    await shot(emp, "timer-grouped-open");
  }
}

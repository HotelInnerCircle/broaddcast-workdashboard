/**
 * The timer list: one line per job, carrying the total.
 *
 * Coming back to a job after a break used to add a second line, so the same
 * work appeared twice and neither line said how long it had taken altogether.
 * The sessions are still stored separately - the grouping is a view, and the
 * first check here holds the API to that.
 */
import { call, signedIn, shot, wait, waitForText, stopTimerWithProof, swipePhoto, PHONE_UA } from "../harness.mjs";

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
  await swipePhoto(emp, "ON_DUTY", 12.9716, 77.5946);
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

  /* ---------- and it fits the screen it is read on (A140) ---------- */
  /*
   * The page was 577px wide on a 360px phone: a grid item defaults to
   * `min-width: auto` and so refuses to shrink below its contents, which meant
   * the row of Pause / Take a break / Stop set the width of the whole page and
   * the viewport just scrolled sideways past it.
   *
   * Measured rather than eyeballed, at the narrow end and on a tablet, with a
   * timer running and a long client name on the screen - the state that made it
   * widest. A check that a page "looks fine" is not one; `scrollWidth` is.
   */
  /*
   * With a timer actually running, which is the state that was too wide: the
   * big clock, the three controls and a long client name are only on the screen
   * then. Measuring the idle form would have passed throughout the bug.
   */
  /*
   * Under a long client name, which is what actually made the page too wide.
   * The first version of this check used the suite's short name and passed
   * against the broken page - it proved nothing. Renamed rather than created:
   * the lab company's plan allows five clients and earlier suites have spent
   * most of them.
   */
  const SHORT = "BHARATHYUNDAI";
  const LONG = "Hindustan Technologies Private Limited";
  await call(admin, `/api/clients/${clientId}`, { name: LONG }, "PATCH");
  await call(emp, "/api/timer/start", {
    clientId, force: true,
    notes: "Homepage wireframes, header revisions and the responsive pass",
  });

  for (const [label, width, height, mobile] of [["a small phone", 320, 780, true], ["a phone", 390, 820, true], ["a tablet", 768, 1000, false]]) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: PHONE_UA } : {}),
      storageState: await emp.context().storageState(),
    });
    const page = await ctx.newPage();
    await page.goto(`${lab.base}/timer`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    /*
     * Waited for the running card itself, not for the page. The hero is a
     * skeleton until the timer state arrives, and a skeleton is narrow - the
     * first version of this check measured that and passed against the broken
     * page twice. "Stop" only exists once a timer is actually on screen.
     */
    await page.waitForSelector('button:has-text("Stop")', { timeout: 30_000 });
    await waitForText(page, /Today.s entries/i, 30_000);
    await wait(600);
    const fit = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      title: Boolean([...document.querySelectorAll("h1")].find((h) => h.textContent?.trim() === "Timer")),
    }));
    check(`the timer page fits ${label} with no sideways scroll`, fit.scroll <= fit.client,
      `scrollWidth=${fit.scroll} viewport=${fit.client}`);
    // The mini-timer used to stick 4rem down on a phone, clearing a navbar that
    // is not there, and sat on top of the heading.
    check(`and its title is not covered on ${label}`, fit.title, "no visible <h1>Timer</h1>");
    if (width === 390) await shot(page, "timer-phone");
    await ctx.close();
  }

  // Left as it was found: a renamed client and a timer still running would both
  // follow whatever suite runs next.
  await call(emp, "/api/timer/stop", {});
  await call(admin, `/api/clients/${clientId}`, { name: SHORT }, "PATCH");
}

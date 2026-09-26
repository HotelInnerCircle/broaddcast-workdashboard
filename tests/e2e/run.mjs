/**
 * Runs the end-to-end suites against a running server.
 *
 *   npm run test:e2e                 every suite
 *   npm run test:e2e -- leave ledger just those two
 *   E2E_KEEP_LAB=1 npm run test:e2e  leave the throwaway company behind
 *
 * The company these suites work in is created at the start and deleted at the
 * end, from a `finally`, so a failure halfway through does not leave a company
 * in the database. `E2E_KEEP_LAB=1` is the escape hatch for when you want to go
 * and look at what the run produced.
 */
import { assertServerUp, BASE, launch, reporter, WORK } from "./harness.mjs";
import { setUpLab, tearDownLab } from "./lab.mjs";

import * as scheduling from "./suites/scheduling.mjs";
import * as swipes from "./suites/swipes.mjs";
import * as timerGrouping from "./suites/timer-grouping.mjs";
import * as leave from "./suites/leave.mjs";
import * as ledger from "./suites/ledger.mjs";
import * as profile from "./suites/profile.mjs";
import * as employeeCodes from "./suites/employee-codes.mjs";
import * as accessControl from "./suites/access-control.mjs";
import * as reports from "./suites/reports.mjs";
import * as singleDevice from "./suites/single-device.mjs";

/**
 * Order matters a little: scheduling clears the holidays it does not own, and
 * leave books the dates ledger then works around, so ledger comes after leave.
 */
// single-device last: it signs in repeatedly, and anything after it would be
// competing for the sign-in rate limit that the whole run shares.
const ALL = [scheduling, swipes, timerGrouping, leave, ledger, profile, employeeCodes, accessControl, reports, singleDevice];

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const suites = wanted.length ? ALL.filter((s) => wanted.includes(s.name)) : ALL;

if (wanted.length && suites.length !== wanted.length) {
  const missing = wanted.filter((w) => !ALL.some((s) => s.name === w));
  console.error(`No such suite: ${missing.join(", ")}\nThere is: ${ALL.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

const started = Date.now();
let browser;
let lab;
const tally = [];

try {
  await assertServerUp();
  console.log(`\nWorkPulse end-to-end -- ${BASE}\n`);

  browser = await launch();
  process.stdout.write("Building a throwaway company... ");
  lab = await setUpLab(browser);
  console.log(`${lab.name}\n`);

  for (const suite of suites) {
    console.log(`${suite.name} -- ${suite.description}`);
    const check = reporter(suite.name);
    const at = Date.now();
    try {
      await suite.default({ browser, lab, check });
    } catch (e) {
      check(`the suite ran to the end`, false, e.message);
      console.log(e.stack?.split("\n").slice(1, 4).join("\n") ?? "");
    }
    const failed = check.results.filter((r) => !r.ok);
    tally.push({ name: suite.name, total: check.results.length, failed: failed.length, results: check.results });
    console.log(`  ${check.results.length - failed.length}/${check.results.length} in ${((Date.now() - at) / 1000).toFixed(1)}s\n`);
  }
} catch (e) {
  console.error(`\n${e.message}\n`);
  tally.push({ name: "setup", total: 1, failed: 1, results: [{ name: e.message, ok: false }] });
} finally {
  if (browser && lab && process.env.E2E_KEEP_LAB !== "1") {
    try {
      const gone = await tearDownLab(browser, lab);
      console.log(gone.ok ? `Removed ${lab.name}.` : `Could not remove ${lab.name} (status ${gone.status}) -- delete it by hand.`);
    } catch (e) {
      console.error(`Could not remove ${lab.name}: ${e.message} -- delete it by hand.`);
    }
  } else if (lab) {
    console.log(`Left ${lab.name} in place (E2E_KEEP_LAB=1).`);
  }
  await browser?.close();
}

const total = tally.reduce((n, s) => n + s.total, 0);
const failed = tally.reduce((n, s) => n + s.failed, 0);

console.log(`\n${"-".repeat(56)}`);
for (const s of tally) console.log(`${s.failed ? "FAIL" : "pass"}  ${s.name.padEnd(16)} ${s.total - s.failed}/${s.total}`);
console.log(`${"-".repeat(56)}`);
console.log(`${total - failed}/${total} checks in ${((Date.now() - started) / 1000).toFixed(0)}s. Screenshots in ${WORK}`);

if (failed) {
  console.log(`\n${failed} failed:`);
  for (const s of tally) for (const r of s.results.filter((x) => !x.ok)) console.log(`  ${s.name}: ${r.name}${r.detail ? ` -- ${r.detail}` : ""}`);
}
process.exit(failed ? 1 : 0);

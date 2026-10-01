/**
 * A139: the admin watches the clock rather than being on it.
 *
 * Two halves, and the second is the one that is easy to break while doing the
 * first: the admin can no longer swipe or run a stopwatch, and the admin can
 * still see everybody who does. A change that quietly took the oversight away
 * with the stopwatch would pass any test that only looked for what is gone.
 */
import { call, signedIn, shot, swipePhoto, wait, waitForText } from "../harness.mjs";

export const name = "on-the-clock";
export const description = "the admin oversees attendance instead of recording it";

/**
 * Where a screen actually leaves you. The redirect out of a screen this role may
 * not have arrives client-side, a moment after the document does, so reading the
 * URL the instant navigation settles reports the page you were sent away from.
 */
async function landsOn(page, base, path) {
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  for (let i = 0; i < 40 && new URL(page.url()).pathname === path; i++) await wait(250);
  return new URL(page.url()).pathname;
}

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const emp = await signedIn(browser, lab.people.emp.email, lab.pw, {
    permissions: ["camera", "geolocation"], geolocation: { latitude: 12.9716, longitude: 77.5946 },
  });

  /* ---------- the stopwatch ---------- */
  /*
   * A client to time against, so the refusals below are unambiguously about the
   * role rather than a malformed body being rejected first.
   *
   * Reused rather than created. The lab company is on a Starter plan that
   * allows five, earlier suites have already made theirs, and a suite that
   * spends the last one makes whichever suite runs next fail for a reason that
   * has nothing to do with it - which is exactly what this did.
   */
  const clients = (await call(admin, "/api/clients?limit=100", null, "GET")).json?.data ?? [];
  let clientId = clients[0]?.id;
  if (!clientId) clientId = (await call(admin, "/api/clients", { name: "ON THE CLOCK LTD" })).json?.data?.id;
  check("a client to time against", Boolean(clientId), `${clients.length} already in the company`);

  const started = await call(admin, "/api/timer/start", { clientId, notes: "should not be possible", force: false });
  check("the admin cannot start a timer", started.status === 403, `status=${started.status}`);
  check("and is told why, not just refused",
    /oversee|permission/i.test(JSON.stringify(started.json?.error ?? "")),
    JSON.stringify(started.json?.error ?? ""));
  const onBreak = await call(admin, "/api/breaks/start", {});
  check("nor take a break", onBreak.status === 403, `status=${onBreak.status}`);

  const afterTimer = await landsOn(admin, lab.base, "/timer");
  check("the stopwatch screen sends them home rather than 404ing", afterTimer !== "/timer", afterTimer);

  /* ---------- the swipe ---------- */
  const swiped = await swipePhoto(admin, "ON_DUTY", 12.9716, 77.5946);
  check("the admin cannot swipe", swiped.status === 403, `status=${swiped.status} ${JSON.stringify(swiped.json?.error ?? "")}`);
  check("and the refusal names the reason",
    /oversee/i.test(JSON.stringify(swiped.json?.error ?? "")), JSON.stringify(swiped.json?.error ?? ""));

  const afterSwipe = await landsOn(admin, lab.base, "/swipe");
  check("the swipe screen sends them home too", afterSwipe !== "/swipe", afterSwipe);

  /* ---------- neither is offered anywhere ---------- */
  await admin.goto(`${lab.base}/attendance`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForText(admin, /Attendance/i, 30_000);
  check("the sidebar offers no stopwatch", (await admin.$$('a[href="/timer"]')).length === 0);
  check("and no swipe screen", (await admin.$$('a[href="/swipe"]')).length === 0);
  check("not even the swipe button on the attendance screen itself",
    (await admin.$$('a:has-text("Swipe on duty"), a:has-text("Swipe off duty")')).length === 0);

  /* ---------- but every view of it is still there ---------- */
  /*
   * The half that matters. The admin's job is to look at everybody, so losing
   * timesheets or the authorisation grid along with the stopwatch would be a
   * worse bug than the one being fixed.
   */
  check("timesheets are still reachable", (await admin.$$('a[href="/timesheets"]')).length > 0);
  const sheets = await call(admin, "/api/time-entries?from=2026-01-01&to=2026-12-31", null, "GET");
  check("and still return everybody's entries, not a 403", sheets.status === 200, `status=${sheets.status}`);

  const seen = await call(admin, "/api/attendance/swipes?page=1&limit=5", null, "GET");
  check("the admin still reads everyone's swipes", seen.status === 200, `status=${seen.status}`);

  await admin.goto(`${lab.base}/timesheets`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("the timesheets screen opens for them", await waitForText(admin, /Timesheet/i, 30_000));

  /* ---------- and they are not reported as absent ---------- */
  /*
   * The consequence that made this worth doing at all: an admin who never
   * swipes was marked absent every working day by the same code that flags a
   * real absence, in the one report meant to be read carefully.
   */
  const month = new Date().toISOString().slice(0, 7);
  const grid = await call(admin, `/api/attendance/authorise?month=${month}`, null, "GET");
  check("the authorisation grid loads", grid.status === 200, `status=${grid.status}`);
  const names = (grid.json?.data?.rows ?? []).map((r) => r.userName ?? r.name);
  check("and does not list the admin, who has no month to sign off",
    !names.includes(lab.people.admin.name), JSON.stringify(names));
  check("while everybody who does swipe is still on it",
    names.includes(lab.people.emp.name), JSON.stringify(names));

  /*
   * A month entirely in the past, and both people backdated into it.
   *
   * Both halves are needed for this to mean anything. In a company created this
   * morning nobody has a day behind them, so "the admin has no absences" would
   * pass without the fix - and on the first of the month the current month has
   * no finished days at all, which is the date-dependence that has bitten this
   * suite before. The employee proves the report is capable of showing an
   * absence; the admin's silence is only evidence next to it.
   */
  const now = new Date();
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const pm = prev.toISOString().slice(0, 7);
  const adminId = lab.ids.admin
    ?? ((await call(admin, "/api/employees?limit=100", null, "GET")).json?.data ?? [])
      .find((r) => r.email === lab.people.admin.email)?.id;
  for (const id of [adminId, lab.ids.emp]) {
    if (id) await call(admin, `/api/employees/${id}`, { joiningDate: `${pm}-01` }, "PATCH");
  }

  const roll = await call(admin, `/api/attendance?from=${pm}-01&to=${pm}-28`, null, "GET");
  const rows = roll.json?.data?.rows ?? roll.json?.data ?? [];
  const absencesFor = (name) => rows.filter((r) => r.user?.name === name && r.status === "Absent").length;
  check("somebody who does swipe is shown the days they missed",
    absencesFor(lab.people.emp.name) > 0, `emp absences=${absencesFor(lab.people.emp.name)} of ${rows.length} rows`);
  check("and the admin's are not invented, in the same report",
    absencesFor(lab.people.admin.name) === 0, `admin absences=${absencesFor(lab.people.admin.name)}`);

  /* ---------- their screen answers the question the role is for ---------- */
  await admin.goto(`${lab.base}/admin/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("the admin dashboard shows today across the company",
    await waitForText(admin, /On duty now/i, 45_000));
  const board = (await admin.textContent("body")) ?? "";
  check("with who has not swiped yet", /Yet to swipe/i.test(board));
  check("and no longer promises it is coming soon", !/Attendance summary/i.test(board), board.slice(0, 160));
  await shot(admin, "admin-today-overview");

  /* ---------- nor a payslip of their own (A141) ---------- */
  /*
   * "My payslips" showed the admin an empty list: they are not paid as staff
   * here. Refused at the endpoint rather than left to return nothing, so the
   * screen is gone rather than blank - and payroll for everybody else, which is
   * a different screen, is untouched.
   */
  const mine = await call(admin, "/api/payslips?mine=true", null, "GET");
  check("the admin has no payslips of their own", mine.status === 403, `status=${mine.status}`);
  check("and is told where payroll actually is",
    /payroll/i.test(JSON.stringify(mine.json?.error ?? "")), JSON.stringify(mine.json?.error ?? ""));

  const afterPayslips = await landsOn(admin, lab.base, "/my/payslips");
  check("the screen sends them home", afterPayslips !== "/my/payslips", afterPayslips);
  await admin.goto(`${lab.base}/admin/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await waitForText(admin, /Today/i, 45_000);
  check("and nothing in the menu points at it", (await admin.$$('a[href="/my/payslips"]')).length === 0);

  // What they do keep: running payroll for everybody else.
  const register = await call(admin, "/api/payslips", null, "GET");
  check("but they still read the payroll register", register.status === 200, `status=${register.status}`);

  const empMine = await call(emp, "/api/payslips?mine=true", null, "GET");
  check("an employee still has their own", empMine.status === 200, `status=${empMine.status}`);

  /* ---------- everybody else is untouched ---------- */
  const empTimer = await call(emp, "/api/timer/start", { clientId, notes: "ordinary work", force: false });
  check("an employee still starts a timer", empTimer.status === 201 || empTimer.status === 200,
    `status=${empTimer.status} ${JSON.stringify(empTimer.json?.error ?? "")}`);
  await call(emp, "/api/timer/stop", {});

  const empSwipe = await swipePhoto(emp, "ON_DUTY", 12.9716, 77.5946);
  check("and still swipes", empSwipe.status === 201 || empSwipe.status === 200,
    `status=${empSwipe.status} ${JSON.stringify(empSwipe.json?.error ?? "")}`);

  await emp.goto(`${lab.base}/swipe`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  check("their swipe screen still opens", await waitForText(emp, /Swipe/i, 30_000));
}

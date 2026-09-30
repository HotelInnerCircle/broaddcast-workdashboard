/**
 * The attendance ledger: what each day counted as, and whether it pays.
 *
 * Two things here earned their place the hard way. Days after today are
 * "Upcoming", not Absent, and days before someone joined are "Before joining" -
 * without that, a person who joined on the 25th opened their first ledger to
 * twenty-four absences.
 *
 * The last two checks are the scope ones. `/api/reports/ledger` once used
 * `{ ...employeeScopeFilter(ctx), _id: asked }`, and for an employee that scope
 * is `{ _id: me }` - which the spread then overwrote, handing anyone anyone
 * else's attendance. It is an `$and` now, and these two checks are why.
 */
import { call, form, signedInEach, shot, swipePhoto, wait, waitForText } from "../harness.mjs";

export const name = "ledger";
export const description = "what each day counted as, and who may read it";

/** Built from a string so a layer of shell quoting cannot eat the escape. */
const WHITESPACE = new RegExp("\\s+", "g");
const MONTH = () => new Date().toISOString().slice(0, 10).slice(0, 7);
const TODAY = () => new Date().toISOString().slice(0, 10);

/**
 * The month after this one.
 *
 * Week offs and days still to come are asserted against it rather than against
 * whatever is left of today's month. On the 28th there were two weekdays left,
 * the test spent one on a holiday and one on a leave day, and then failed
 * because nothing remained to be "Upcoming" - and the last Sunday had fallen
 * before the day the test's employee was created, so there was no week off to
 * find either. Both were the calendar running out, not the ledger being wrong.
 * Next month is always entirely ahead and always has Sundays in it.
 */
const NEXT_MONTH = () => {
  const d = new Date();
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
};

/**
 * Every weekday in a month, given as YYYY-MM.
 *
 * The holiday and the leave day are placed in *next* month rather than in what
 * is left of this one. Taking them from the remainder of the current month
 * meant the suite ran out of calendar: on the 28th there were two weekdays
 * left, exactly enough, and on the 29th there was one - so the whole suite
 * refused to run and thirty-five checks quietly stopped happening. Next month
 * has eighteen at worst, always.
 */
function weekdaysIn(month) {
  const [y, m] = month.split("-").map(Number);
  const out = [];
  for (let day = 1; day <= 31; day++) {
    const x = new Date(y, m - 1, day);
    if (x.getMonth() !== m - 1) break;
    if (x.getDay() === 0 || x.getDay() === 6) continue;
    out.push(`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return out;
}

export default async function run({ browser, lab, check }) {
  const [hr, lead, mgr, emp] = await signedInEach(browser, lab.pw,
    [lab.people.hr.email, lab.people.lead.email, lab.people.mgr.email, lab.people.emp.email]);

  const days = weekdaysIn(NEXT_MONTH());
  check("there are working days to test with", days.length >= 2, `${days.length} weekdays in ${NEXT_MONTH()}`);

  // Today: a real clock-in, so one day is Present or Late rather than Absent,
  // and a swipe so the day has something to open. Made here rather than relying
  // on the swipes suite having run - this suite has to stand on its own.
  // On duty, by the only means there is now (A121): the swipe is the record,
  // and the day's attendance is worked out from it.
  await swipePhoto(emp, "ON_DUTY", 12.9716, 77.5946);
  // And one well away from anywhere, so the sheet has both cases to show: the
  // nearest site is recorded either way, and only one of them was actually at it.
  await swipePhoto(emp, "OFF_DUTY", 13.05, 77.72);

  const holidayOn = days[0];
  await call(hr, "/api/holidays", { date: holidayOn, name: "Founders Day" });
  // Both years, because next month is January when this runs in December and
  // the allowance is held per year.
  for (const year of new Set([new Date().getFullYear(), Number(NEXT_MONTH().slice(0, 4))])) {
    await call(hr, "/api/leave/policies", { type: "CL", year, daysPerYear: 12 }, "PUT");
  }

  // The leave suite may already hold some of these dates, so take the first day
  // that is actually free rather than assuming.
  let leaveOn = null;
  let asked = null;
  for (const day of days.slice(1)) {
    const r = await form(emp, "/api/leave", { type: "CL", startDate: day, endDate: day });
    if (r.status === 201) { leaveOn = day; asked = r; break; }
    if (r.status !== 409) { asked = r; break; }
  }
  check("a leave day can be booked to test with", Boolean(leaveOn), `status=${asked?.status} ${JSON.stringify(asked?.json?.error ?? "")}`);

  if (leaveOn) {
    const id = asked.json?.data?.id;
    await call(lead, `/api/leave/${id}/decision`, { decision: "APPROVED" });
    await call(mgr, `/api/leave/${id}/decision`, { decision: "APPROVED" });
    await call(hr, `/api/leave/${id}/decision`, { decision: "APPROVED" });
  }

  const res = await call(emp, `/api/reports/ledger?month=${MONTH()}`, null, "GET");
  const L = res.json?.data;
  check("the ledger loads", res.status === 200 && Boolean(L), `status=${res.status}`);
  check("it covers the whole month", L?.days?.length >= 28, `${L?.days?.length} days`);

  const byDate = new Map((L?.days ?? []).map((d) => [d.date, d]));

  /*
   * Next month carries the holiday and the leave day, and is wholly after the
   * join date, so it is also where the week off and the upcoming days are read
   * from. This month is only asked about today - the clock-in, and the days
   * before somebody joined.
   */
  const nextRes = await call(emp, `/api/reports/ledger?month=${NEXT_MONTH()}`, null, "GET");
  const N = nextRes.json?.data;
  check("next month's ledger loads too", nextRes.status === 200 && Boolean(N), `status=${nextRes.status}`);
  const byNext = new Map((N?.days ?? []).map((d) => [d.date, d]));

  check("the holiday shows as a holiday", byNext.get(holidayOn)?.kind === "Holiday", `${holidayOn} -> ${byNext.get(holidayOn)?.kind}`);
  check("and names it", byNext.get(holidayOn)?.detail === "Founders Day", byNext.get(holidayOn)?.detail);
  check("a holiday still earns pay", byNext.get(holidayOn)?.payable === true);

  if (leaveOn) {
    check("approved leave shows as leave", byNext.get(leaveOn)?.kind === "Leave", `${leaveOn} -> ${byNext.get(leaveOn)?.kind}`);
    check("and names the type", byNext.get(leaveOn)?.detail === "Casual Leave", byNext.get(leaveOn)?.detail);
    check("casual leave is paid", byNext.get(leaveOn)?.payable === true);
  }

  const weekend = (N?.days ?? []).find((d) => d.weekday === "Sun");
  check("Sunday is a week off", weekend?.kind === "Week off", `${weekend?.date} -> ${weekend?.kind}`);
  check("nobody is docked for a Sunday", weekend?.payable === true, weekend?.date);

  const today = TODAY();
  const todayKind = byDate.get(today)?.kind;
  // A clock-in on a Saturday does not make it a working day, so what "today"
  // should say depends on the company calendar rather than on the clock-in.
  if (todayKind === "Week off" || todayKind === "Holiday") {
    check("a clock-in on a day off leaves it a day off, and still paid", byDate.get(today)?.payable === true, todayKind);
  } else {
    check("today shows the clock-in", ["Present", "Late", "Half Day"].includes(todayKind), todayKind);
  }
  // Also next month's, for the same reason: what is left of this one gets spent
  // on the holiday and the leave day, and on the 28th that was all of it.
  const upcoming = (N?.days ?? []).filter((d) => d.date > today && d.kind === "Upcoming").length;
  check("days still to come are not marked absent", upcoming > 0, `${upcoming} upcoming in ${NEXT_MONTH()}`);
  check("and none of next month is an absence yet",
    (N?.days ?? []).every((d) => d.kind !== "Absent"),
    (N?.days ?? []).filter((d) => d.kind === "Absent").slice(0, 3).map((d) => d.date).join(", "));
  /* ---------- the month somebody signs off (A130) ---------- */
  /*
   * The step that was missing between a swipe and a payslip. Everything else
   * runs on its own - the swipe carries a photograph and a face, the day is
   * derived from the swipes, payroll counts the payable days - and nowhere did
   * a person look at a month and say it was right.
   */
  const grid = await call(hr, `/api/attendance/authorise?month=${MONTH()}`, null, "GET");
  check("the authorisation grid loads", grid.status === 200, `status=${grid.status}`);
  check("it has a row per person in scope", (grid.json?.data?.rows ?? []).length > 0, `${(grid.json?.data?.rows ?? []).length} rows`);
  check("and a column per day of the month", (grid.json?.data?.dates ?? []).length >= 28, `${(grid.json?.data?.dates ?? []).length} days`);
  const gridRow = (grid.json?.data?.rows ?? []).find((r) => r.userId === lab.ids.emp);
  check("every row carries the days and the totals", Boolean(gridRow?.days?.length && gridRow?.summary), JSON.stringify(gridRow?.summary ?? {}));

  const empGrid = await call(emp, `/api/attendance/authorise?month=${MONTH()}`, null, "GET");
  const empSees = (empGrid.json?.data?.rows ?? []).map((r) => r.userId);
  // Scoped like everything else: an employee sees themselves, never the company.
  check("an employee sees only themselves in it",
    empGrid.status !== 200 || (empSees.length <= 1 && (empSees.length === 0 || empSees[0] === lab.ids.emp)),
    `status=${empGrid.status} ${JSON.stringify(empSees)}`);

  /*
   * The reason is required, and not as a formality. A day changed by hand
   * months later with no note is indistinguishable from a mistake, and these
   * are the entries that move money.
   */
  const noNote = await call(hr, "/api/attendance/authorise",
    { userId: lab.ids.emp, date: today, status: "Present", note: "" }, "PATCH");
  check("settling a day without a reason is refused", noNote.status === 422 || noNote.status === 400, `status=${noNote.status}`);

  const settled = await call(hr, "/api/attendance/authorise",
    { userId: lab.ids.emp, date: today, status: "Present", note: "Forgot to swipe off - confirmed with their lead." }, "PATCH");
  check("HR can settle a day with one", settled.status === 200, `status=${settled.status} ${JSON.stringify(settled.json?.error ?? "")}`);
  check("and it takes the status they chose", settled.json?.data?.status === "Present", settled.json?.data?.status);

  const byEmployee = await call(emp, "/api/attendance/authorise",
    { userId: lab.ids.emp, date: today, status: "Present", note: "I was here honestly" }, "PATCH");
  check("an employee cannot settle their own day", [401, 403].includes(byEmployee.status), `status=${byEmployee.status}`);

  /*
   * And it survives a swipe arriving afterwards. syncAttendanceFromSwipes
   * leaves alone any day somebody set by hand - a decision must never be
   * quietly recomputed away by a late swipe.
   */
  await swipePhoto(emp, "OFF_DUTY", 12.9716, 77.5946);
  const after = await call(hr, `/api/attendance/authorise?month=${MONTH()}`, null, "GET");
  const stillSet = (after.json?.data?.rows ?? []).find((r) => r.userId === lab.ids.emp)?.days?.find((d) => d.date === today);
  check("a settled day is not recomputed away by a later swipe",
    stillSet?.kind === "Present", `${stillSet?.kind}`);

  const beforeJoining = (L?.days ?? []).filter((d) => d.date < L.joinedOn);
  check("days before the join date are not absences", beforeJoining.every((d) => d.kind === "Before joining"),
    `${beforeJoining.length} days before ${L?.joinedOn}`);

  const s = L?.summary;
  check("the summary counts payable days", s?.payableDays > 0, `payable=${s?.payableDays}, working=${s?.workingDays}`);
  check("loss of pay is zero here", s?.lossOfPay === 0, String(s?.lossOfPay));

  /* ---------- scope ---------- */
  const other = await call(emp, `/api/reports/ledger?month=${MONTH()}&userId=${lab.ids.hr}`, null, "GET");
  check("an employee cannot read someone else's ledger", other.status === 403, `status=${other.status}`);
  const asHr = await call(hr, `/api/reports/ledger?month=${MONTH()}&userId=${lab.ids.emp}`, null, "GET");
  check("HR can read anyone's", asHr.status === 200 && asHr.json?.data?.userId === lab.ids.emp, `status=${asHr.status}`);

  /* ---------- the page ---------- */
  await hr.goto(`${lab.base}/reports/ledger`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const rendered = await waitForText(hr, /Payable days/, 45_000);
  const body = await hr.textContent("body");
  check("the page renders the month", rendered && /Attendance ledger/.test(body), rendered ? "heading missing" : "Payable days never appeared");
  await hr.waitForSelector("select", { timeout: 20_000 }).catch(() => {});
  check("it offers an employee picker to HR", Boolean(await hr.$("select")));
  await shot(hr, "ledger");

  /* ---------- calendar, list, and opening a day (A100) ---------- */
  check("the month is shown as a calendar by default", Boolean(await hr.$('button[aria-pressed="true"]')));
  const cells = await hr.$$eval("button[aria-label]",
    (els) => els.filter((e) => /^[0-9]{4}-[0-9]{2}-[0-9]{2},/.test(e.getAttribute("aria-label") ?? "")).length);
  check("the calendar draws a cell per day", cells >= 28, `${cells} cells`);
  const legend = await hr.textContent("body");
  check("the codes are spelled out in a legend", /Week off/.test(legend) && /Half day/.test(legend));
  await shot(hr, "ledger-calendar");

  await hr.click('button:has-text("List")');
  await waitForText(hr, /Late in/, 20_000);
  const listBody = await hr.textContent("body");
  check("the list shows in, out, late in and early out", /In:/.test(listBody) && /Out:/.test(listBody) && /Late in/.test(listBody) && /Early out/.test(listBody));
  await shot(hr, "ledger-list");

  // The swipes belong to the employee, not to HR, so switch the picker to them
  // first - HR's own ledger has nothing to open.
  await hr.selectOption("select", lab.ids.emp);
  await waitForText(hr, /Late in/, 30_000);

  // Selected by accessible name rather than by visible text: "swipe" also appears
  // in the sidebar's navigation, and clicking that navigates away instead.
  const openable = await hr.$('button[aria-label*="swipes"]');
  check("a day with swipes is marked as having them", Boolean(openable));
  if (openable) {
    await openable.click();
    const sheet = await waitForText(hr, /View on map/, 25_000);
    check("opening a day shows the swipe detail", sheet, "the sheet never appeared");
    const detail = await hr.textContent('[role="dialog"]').catch(() => "");
    check("it shows the time and the place", /Time/.test(detail) && /Place/.test(detail));
    check("it shows how far from a site it was", /Distance/.test(detail) || /work site/.test(detail));
    // The stored site name is the *nearest* site, not where the person was. A
    // swipe two kilometres out must not be presented as having been at it.
    check("a swipe away from every site says so, rather than naming one",
      detail.includes("Away from every work site"), detail.replace(WHITESPACE, " ").slice(0, 240));

    // Waited for, not sampled: the photo is a signed URL fetched from storage
    // and is still in flight when the sheet first appears. Checking that it
    // *loaded* rather than that the tag exists is the difference between
    // catching a broken URL and photographing an empty box.
    const loaded = await hr.waitForFunction(
      () => { const i = document.querySelector('[role="dialog"] img'); return Boolean(i && i.complete && i.naturalWidth > 0); },
      undefined, { timeout: 20_000, polling: 250 },
    ).then(() => true).catch(() => false);
    const shownPhoto = await hr.$eval('[role="dialog"] img', (img) => ({ done: img.complete, w: img.naturalWidth })).catch(() => null);
    check("the photo actually loads, not just exists", loaded, JSON.stringify(shownPhoto));
    check("it shows the photo that was taken", Boolean(await hr.$('[role="dialog"] img')));
    const mapHref = await hr.getAttribute('[role="dialog"] a[href*="google.com/maps"]', "href");
    // Explicit classes, no shorthand: a backslash in this file has been eaten by
    // a layer of shell quoting before now, and the pattern then matches nothing.
    const COORDS = new RegExp("query=-?[0-9]+[.][0-9]+,-?[0-9]+[.][0-9]+");
    check("the map link points at the recorded coordinates", COORDS.test(mapHref ?? ""), mapHref ?? "");
    await shot(hr, "ledger-day-sheet");
    await hr.click('[role="dialog"] button[aria-label="Close"]');
    await wait(500);
    check("it closes again", (await hr.$$('[role="dialog"]')).length === 0);
  }
}

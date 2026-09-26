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

/** Weekdays still to come this month, in order - working days that are not today. */
function futureWeekdays() {
  const d = new Date();
  const out = [];
  for (let i = 1; i <= 28; i++) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    if (x.getMonth() !== d.getMonth()) break;
    if (x.getDay() === 0 || x.getDay() === 6) continue;
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`);
  }
  return out;
}

export default async function run({ browser, lab, check }) {
  const [hr, lead, mgr, emp] = await signedInEach(browser, lab.pw,
    [lab.people.hr.email, lab.people.lead.email, lab.people.mgr.email, lab.people.emp.email]);

  const days = futureWeekdays();
  if (days.length < 2) {
    // Late in a month there is no room left to place a holiday and a leave day.
    check("there are working days left this month to test with", false, `${days.length} weekdays remain`);
    return;
  }

  // Today: a real clock-in, so one day is Present or Late rather than Absent,
  // and a swipe so the day has something to open. Made here rather than relying
  // on the swipes suite having run - this suite has to stand on its own.
  await call(emp, "/api/attendance/clock-in", {});
  await swipePhoto(emp, "ON_DUTY", 12.9716, 77.5946);
  // And one well away from anywhere, so the sheet has both cases to show: the
  // nearest site is recorded either way, and only one of them was actually at it.
  await swipePhoto(emp, "OFF_DUTY", 13.05, 77.72);

  const holidayOn = days[0];
  await call(hr, "/api/holidays", { date: holidayOn, name: "Founders Day" });
  await call(hr, "/api/leave/policies", { type: "CL", year: new Date().getFullYear(), daysPerYear: 12 }, "PUT");

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
  check("the holiday shows as a holiday", byDate.get(holidayOn)?.kind === "Holiday", `${holidayOn} -> ${byDate.get(holidayOn)?.kind}`);
  check("and names it", byDate.get(holidayOn)?.detail === "Founders Day", byDate.get(holidayOn)?.detail);
  check("a holiday still earns pay", byDate.get(holidayOn)?.payable === true);

  if (leaveOn) {
    check("approved leave shows as leave", byDate.get(leaveOn)?.kind === "Leave", `${leaveOn} -> ${byDate.get(leaveOn)?.kind}`);
    check("and names the type", byDate.get(leaveOn)?.detail === "Casual Leave", byDate.get(leaveOn)?.detail);
    check("casual leave is paid", byDate.get(leaveOn)?.payable === true);
  }

  // A Sunday the person was actually employed for - earlier ones are "Before joining".
  const weekend = (L?.days ?? []).find((d) => d.weekday === "Sun" && d.date >= L.joinedOn);
  check("Sunday is a week off", weekend?.kind === "Week off", weekend?.kind);
  check("nobody is docked for a Sunday", weekend?.payable === true);

  const today = TODAY();
  const todayKind = byDate.get(today)?.kind;
  // A clock-in on a Saturday does not make it a working day, so what "today"
  // should say depends on the company calendar rather than on the clock-in.
  if (todayKind === "Week off" || todayKind === "Holiday") {
    check("a clock-in on a day off leaves it a day off, and still paid", byDate.get(today)?.payable === true, todayKind);
  } else {
    check("today shows the clock-in", ["Present", "Late", "Half Day"].includes(todayKind), todayKind);
  }
  const upcoming = (L?.days ?? []).filter((d) => d.date > today && d.kind === "Upcoming").length;
  check("days still to come are not marked absent", upcoming > 0, `${upcoming} upcoming`);
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

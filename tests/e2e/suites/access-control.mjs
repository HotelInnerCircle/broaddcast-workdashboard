/**
 * What an ordinary employee is refused.
 *
 * Every check here is an attack that worked. The people-scope filter used to be
 * a bare `{ _id: me }`, and half the codebase asked for one person by writing
 * `{ ...scope, _id: askedFor }` - a spread that replaced the restriction instead
 * of adding to it. Passing `?userId=` as a plain employee returned a colleague's
 * attendance, their leave history, their profile, and their swipes, which carry
 * a photograph and a GPS fix.
 *
 * The unit tests pin the filter's shape. This pins the behaviour over HTTP,
 * because that is what an attacker actually has.
 */
import { call, signedIn, wait } from "../harness.mjs";

export const name = "access-control";
export const description = "what an employee is refused, over HTTP";

const MONTH = new Date().toISOString().slice(0, 7);
const TODAY = new Date().toISOString().slice(0, 10);

export default async function run({ browser, lab, check }) {
  const emp = await signedIn(browser, lab.people.emp.email, lab.pw);
  const hr = await signedIn(browser, lab.people.hr.email, lab.pw);
  const target = lab.ids.hr; // somebody an employee has no business reading

  /**
   * Reading someone else must be refused outright, not answered with an empty
   * list: an empty list is indistinguishable from "that person has no records",
   * and a filter that returns nothing today can start returning rows tomorrow.
   */
  const refusals = [
    ["attendance", `/api/attendance?from=${TODAY}&to=${TODAY}&userId=${target}`],
    ["the attendance ledger", `/api/reports/ledger?month=${MONTH}&userId=${target}`],
    ["leave history", `/api/leave?userId=${target}&page=1&limit=20`],
    ["a leave balance", `/api/leave/balance?userId=${target}`],
    ["swipes, with their photo and location", `/api/attendance/swipes?userId=${target}&limit=20`],
    ["a profile, with its address and date of birth", `/api/me/profile?userId=${target}`],
    ["breaks", `/api/breaks?from=${TODAY}&to=${TODAY}&userId=${target}`],
  ];

  for (const [what, url] of refusals) {
    const res = await call(emp, url, null, "GET");
    check(`an employee is refused someone else's ${what}`, res.status === 403, `status=${res.status}`);
  }

  /* ---------- and still gets their own ---------- */
  for (const [what, url] of [
    ["attendance", `/api/attendance?from=${TODAY}&to=${TODAY}`],
    ["ledger", `/api/reports/ledger?month=${MONTH}`],
    ["leave", `/api/leave?page=1&limit=20`],
    ["balance", `/api/leave/balance`],
    ["swipes", `/api/attendance/swipes?limit=20`],
    ["profile", `/api/me/profile`],
  ]) {
    const res = await call(emp, url, null, "GET");
    check(`an employee still reads their own ${what}`, res.status === 200, `status=${res.status}`);
  }

  // Asking for yourself by id is the same as asking for yourself.
  const own = await call(emp, `/api/reports/ledger?month=${MONTH}&userId=${lab.ids.emp}`, null, "GET");
  check("naming your own id is allowed", own.status === 200, `status=${own.status}`);

  /* ---------- HR, who may, is not blocked by any of it ---------- */
  for (const [what, url] of [
    ["attendance", `/api/attendance?from=${TODAY}&to=${TODAY}&userId=${lab.ids.emp}`],
    ["the ledger", `/api/reports/ledger?month=${MONTH}&userId=${lab.ids.emp}`],
    ["a profile", `/api/me/profile?userId=${lab.ids.emp}`],
    ["a leave balance", `/api/leave/balance?userId=${lab.ids.emp}`],
  ]) {
    const res = await call(hr, url, null, "GET");
    check(`HR can still read an employee's ${what}`, res.status === 200, `status=${res.status}`);
  }

  /* ---------- pages an employee has no grant for ---------- */
  for (const [what, url] of [
    ["the people directory", "/api/employees?limit=20"],
    ["the live status board", "/api/dashboard/status"],
    ["the audit log", "/api/admin/audit?page=1&limit=20"],
  ]) {
    const res = await call(emp, url, null, "GET");
    check(`an employee cannot read ${what}`, res.status === 403, `status=${res.status}`);
  }

  // Reading the work sites is allowed on purpose: the swipe screen has to say
  // which site you are standing in. Creating one is the privileged half.
  const readSites = await call(emp, "/api/work-sites", null, "GET");
  check("an employee may read the work sites, which swiping needs", readSites.status === 200, `status=${readSites.status}`);
  const madeSite = await call(emp, "/api/work-sites", { name: "Mine", lat: 12.9, lng: 77.6, radiusMeters: 100 });
  check("but cannot create one", madeSite.status === 403, `status=${madeSite.status}`);

  /* ---------- nor rewrite their own standing ---------- */
  await call(emp, "/api/me", { role: "COMPANY_ADMIN" }, "PATCH");
  const after = await call(emp, "/api/me/profile", null, "GET");
  check("an employee cannot promote themselves", after.json?.data?.profile?.role === "EMPLOYEE", after.json?.data?.profile?.role);

  const asId = await call(emp, `/api/employees/${target}`, { name: "Renamed by an employee" }, "PATCH");
  check("an employee cannot edit another employee", [403, 404].includes(asId.status), `status=${asId.status}`);

  /* ---------- a search box is not a regex box ---------- */
  // Unescaped, this is catastrophic backtracking: the server would sit at 100%
  // CPU instead of answering. What is being checked is that it answers at all.
  const nasty = encodeURIComponent("(a+)+$" + "a".repeat(40));
  const began = Date.now();
  const search = await call(emp, `/api/clients?q=${nasty}&limit=20`, null, "GET");
  const took = Date.now() - began;
  check("a regex bomb in a search term does not hang the server", took < 8000 && search.status < 500, `${took}ms, status=${search.status}`);

  const bracket = await call(emp, `/api/clients?q=${encodeURIComponent("[unclosed")}&limit=20`, null, "GET");
  check("an invalid regex in a search term is not an error", bracket.status < 500, `status=${bracket.status}`);

  /* ---------- a nonsense id is refused, not a 500 ---------- */
  const junk = await call(emp, `/api/reports/ledger?month=${MONTH}&userId=not-an-id`, null, "GET");
  check("a malformed user id is refused cleanly", junk.status === 403, `status=${junk.status}`);

  /* ---------- operator injection at the sign-in form ---------- */
  // Typed into the real form, because that is the way in. If the credentials
  // reached the query unparsed, {"$ne":null} would match the first user in the
  // collection and sign the browser in as them. Zod parses first, so it does not.
  const attacker = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await attacker.newPage();
  await page.goto(`${lab.base}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.fill('input[type="email"]', '{"$ne":null}');
  await page.fill('input[type="password"]', '{"$ne":null}');
  await page.click('button[type="submit"]');
  await wait(6000);
  check("a Mongo operator typed as an email signs nobody in", new URL(page.url()).pathname.startsWith("/login"), page.url());
  await attacker.close();
}

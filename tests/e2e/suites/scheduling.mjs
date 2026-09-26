/**
 * Shifts, holidays, and the phone's profile page.
 *
 * The overnight shift is the one that matters: 22:00 to 07:00 is a negative
 * number if anybody subtracts the two naively, and a night worker's day would
 * silently come out as minus fifteen hours.
 */
import { call, signedIn, shot, wait } from "../harness.mjs";

export const name = "scheduling";
export const description = "shifts, holidays, and the phone's profile page";

export default async function run({ browser, lab, check }) {
  const hr = await signedIn(browser, lab.people.hr.email, lab.pw);
  const emp = await signedIn(browser, lab.people.emp.email, lab.pw);

  /* ---------- shifts ---------- */
  for (const old of (await call(hr, "/api/shifts", null, "GET")).json?.data ?? []) {
    await call(hr, `/api/shifts/${old.id}`, null, "DELETE");
  }
  const made = await call(hr, "/api/shifts", {
    name: "Night", startTime: "22:00", endTime: "07:00",
    workingDays: ["mon", "tue", "wed", "thu", "fri"], lateThresholdMinutes: 15,
  });
  check("HR can create a shift", made.status === 201, `status=${made.status} ${JSON.stringify(made.json?.error ?? "")}`);
  const shiftId = made.json?.data?.id;
  check("it knows the shift runs overnight", made.json?.data?.overnight === true);
  check("an employee cannot create one",
    (await call(emp, "/api/shifts", { name: "Nope", startTime: "09:00", endTime: "10:00", workingDays: ["mon"], lateThresholdMinutes: 5 })).status === 403);
  check("a duplicate name is refused",
    (await call(hr, "/api/shifts", { name: "Night", startTime: "22:00", endTime: "07:00", workingDays: ["mon"], lateThresholdMinutes: 5 })).status === 409);
  check("a bad time is refused",
    (await call(hr, "/api/shifts", { name: "Bad", startTime: "25:00", endTime: "07:00", workingDays: ["mon"], lateThresholdMinutes: 5 })).status === 422);

  /* ---------- assigning it ---------- */
  const assign = await call(hr, `/api/employees/${lab.ids.emp}`, { shiftId }, "PATCH");
  check("HR can put someone on a shift", assign.status === 200, `status=${assign.status} ${JSON.stringify(assign.json?.error ?? "")}`);
  const after = (await call(hr, "/api/shifts", null, "GET")).json?.data ?? [];
  check("the shift shows how many people are on it", after.find((s) => s.id === shiftId)?.people === 1,
    `people=${after.find((s) => s.id === shiftId)?.people}`);

  /* ---------- holidays ---------- */
  for (const old of (await call(hr, "/api/holidays", null, "GET")).json?.data ?? []) {
    await call(hr, `/api/holidays/${old.id}`, null, "DELETE");
  }
  const xmas = `${new Date().getFullYear()}-12-25`;
  const h = await call(hr, "/api/holidays", { date: xmas, name: "Christmas" });
  check("HR can add a holiday", h.status === 201, `status=${h.status}`);
  check("the same date twice is refused", (await call(hr, "/api/holidays", { date: xmas, name: "Again" })).status === 409);
  const seen = await call(emp, "/api/holidays", null, "GET");
  check("everyone can read the holidays", (seen.json?.data ?? []).some((x) => x.name === "Christmas"), `status=${seen.status}`);
  check("an employee cannot add one",
    (await call(emp, "/api/holidays", { date: `${new Date().getFullYear()}-12-26`, name: "Nope" })).status === 403);

  /* ---------- removing a shift frees its people ---------- */
  const gone = await call(hr, `/api/shifts/${shiftId}`, null, "DELETE");
  check("deleting a shift moves its people back to company hours", gone.json?.data?.moved === 1, `moved=${gone.json?.data?.moved}`);

  /* ---------- the phone's profile page ---------- */
  const m = await signedIn(browser, lab.people.emp.email, lab.pw, { mobile: true });
  await wait(2000);
  const tab = await m.$('a[href="/profile"]');
  check("Profile is a link, not a drawer trigger", Boolean(tab));
  check("no drawer is left in the page", (await m.$$('[role="dialog"]')).length === 0);
  if (tab) {
    await tab.click();
    await m.waitForURL((u) => u.pathname === "/profile", { timeout: 20_000 });
    await wait(1500);
    const body = await m.textContent("body");
    check("the profile page carries the whole menu", /Attendance/.test(body) && /Chat/.test(body) && /Timer/.test(body));
    check("it shows who you are", body.includes(lab.people.emp.name));
    check("it can sign you out", Boolean(await m.$('button:has-text("Sign out")')));
    await shot(m, "mobile-profile");
    await m.goBack();
    await wait(1200);
    check("back works, because it is a page", !m.url().endsWith("/profile"), m.url());
  }
}

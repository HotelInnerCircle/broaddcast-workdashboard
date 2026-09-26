/**
 * One phone at a time, and the newest sign-in wins.
 *
 * Signing in on a second phone ends the first phone's session; the first phone
 * finds out on its very next request, and lands on the login screen with a line
 * saying what happened rather than being dropped there with no explanation.
 * Desktops are deliberately left alone - the point is to stop one login being
 * shared around so somebody else can swipe attendance, not to stop HR having the
 * desktop app open while their phone is in their pocket.
 *
 * Two things shape how this is written. It signs in as a person it creates
 * itself, because sharing the lab's employee would revoke the pooled phone
 * session other suites are holding and they would fail for a reason that has
 * nothing to do with them. And it uses as few sign-ins as it can: the real
 * sign-in rate limit is ten a minute per IP, which a whole run shares.
 */
import { BASE, call, login, signedIn } from "../harness.mjs";

export const name = "single-device";
export const description = "one phone at a time, newest sign-in wins";

/** A fresh context each time - these are meant to be different devices. */
const asPhone = (browser, email, pw) => login(browser, email, pw, { mobile: true });
const whoAmI = (page) => call(page, "/api/me/profile", null, "GET");

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const email = `device-${Date.now().toString(36)}@e2e.local`;
  const made = await call(admin, "/api/employees", { name: "Device Tester", email, password: lab.pw, role: "EMPLOYEE" });
  check("somebody to sign in as", made.status === 201, `status=${made.status} ${JSON.stringify(made.json?.error ?? "")}`);
  if (made.status !== 201) return;

  /* ---------- a phone and a desktop, together ---------- */
  const phoneOne = await asPhone(browser, email, lab.pw);
  check("the first phone signs in", (await whoAmI(phoneOne)).status === 200);
  check("and it really looks like a phone to the server",
    (await phoneOne.evaluate(() => navigator.userAgent)).includes("Android"),
    "the context is not sending a phone user agent, so this suite would prove nothing");

  const desktop = await login(browser, email, lab.pw);
  check("a desktop signs in alongside it", (await whoAmI(desktop)).status === 200);
  check("and the phone is still signed in", (await whoAmI(phoneOne)).status === 200);

  /* ---------- a second phone takes over ---------- */
  const phoneTwo = await asPhone(browser, email, lab.pw);
  check("the second phone signs in", (await whoAmI(phoneTwo)).status === 200);
  check("the first phone is signed out", (await whoAmI(phoneOne)).status === 401, `status=${(await whoAmI(phoneOne)).status}`);
  check("the desktop is left alone", (await whoAmI(desktop)).status === 200);

  /* ---------- and the old phone is told why ---------- */
  await phoneOne.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await phoneOne.waitForURL((u) => u.pathname.startsWith("/login"), { timeout: 30_000 }).catch(() => {});
  check("the first phone lands on the login screen", new URL(phoneOne.url()).pathname.startsWith("/login"), phoneOne.url());
  const shown = (await phoneOne.textContent("body")) ?? "";
  check("and is told it was signed out elsewhere", /signed out because this account was used/i.test(shown),
    shown.replace(/\s+/g, " ").slice(0, 200));
  check("the message names the device that took over", /Android/i.test(shown), "no device named");

  /* ---------- nobody can be locked out ---------- */
  // The reason for newest-wins: a lost, broken or wiped phone leaves nothing
  // behind that keeps somebody out of their own account.
  const phoneThree = await asPhone(browser, email, lab.pw);
  check("signing in again always works, from any phone", (await whoAmI(phoneThree)).status === 200);
  check("which in turn ends the previous one", (await whoAmI(phoneTwo)).status === 401);

  /* ---------- it is per person ---------- */
  const somebodyElse = await asPhone(browser, lab.people.lead.email, lab.pw);
  check("somebody else's phone is unaffected", (await whoAmI(somebodyElse)).status === 200);
  check("and so is the one that just signed in", (await whoAmI(phoneThree)).status === 200);

  for (const p of [phoneOne, phoneTwo, phoneThree, desktop, somebodyElse]) {
    await p.context().close().catch(() => {});
  }
}

/**
 * The profile: personal details, the photo, and who is allowed to change what.
 *
 * The date of birth check is not padding. The validation regex was once written
 * through a shell that ate its backslashes, so it arrived as /^d{4}-d{2}-d{2}$/
 * and every single profile save came back 422. A round trip catches that; a
 * glance at the file does not.
 */
import { call, signedIn, shot, wait } from "../harness.mjs";

export const name = "profile";
export const description = "personal details, the photo, and who may change what";

export default async function run({ browser, lab, check }) {
  const emp = await signedIn(browser, lab.people.emp.email, lab.pw, { mobile: true });
  const hr = await signedIn(browser, lab.people.hr.email, lab.pw);

  /* ---------- HR sets the employment facts ---------- */
  const set = await call(hr, `/api/employees/${lab.ids.emp}`,
    { branch: "Hyderabad", department: "Delivery", designation: "Coordinator" }, "PATCH");
  check("HR can set branch, department and designation", set.status === 200,
    `status=${set.status} ${JSON.stringify(set.json?.error ?? "")}`);

  /* ---------- the employee fills in their own ---------- */
  const saved = await call(emp, "/api/me", {
    gender: "female", maritalStatus: "single", dateOfBirth: "1996-04-12",
    address: "12 MG Road, Hyderabad", phone: "+91 98765 43210",
    emergencyContact: { name: "Ravi Nair", relation: "Father", phone: "+91 90000 11111" },
    updateRequest: "My designation should be Senior Coordinator",
  }, "PATCH");
  check("an employee can save their own details", saved.status === 200, `status=${saved.status}`);

  const prof = await call(emp, "/api/me/profile", null, "GET");
  const d = prof.json?.data?.profile;
  check("the profile reads back", prof.status === 200 && Boolean(d), `status=${prof.status}`);
  check("personal details are stored",
    d?.gender === "female" && d?.maritalStatus === "single" && d?.dateOfBirth === "1996-04-12",
    `${d?.gender}/${d?.maritalStatus}/${d?.dateOfBirth}`);
  check("the date of birth does not slide a day", d?.dateOfBirth === "1996-04-12", d?.dateOfBirth);
  check("the emergency contact is stored", d?.emergencyContact?.name === "Ravi Nair" && d?.emergencyContact?.relation === "Father");
  check("employment facts come from HR",
    d?.branch === "Hyderabad" && d?.department === "Delivery" && d?.designation === "Coordinator",
    `${d?.branch}/${d?.department}/${d?.designation}`);
  check("the company name is shown", Boolean(d?.companyName), d?.companyName);
  check("the update request is recorded", Boolean(d?.updateRequest?.includes("Senior Coordinator")));

  /* ---------- an employee cannot rewrite their own job ---------- */
  await call(emp, "/api/me", { designation: "CEO", branch: "Head Office" }, "PATCH");
  const after = await call(emp, "/api/me/profile", null, "GET");
  check("an employee cannot change their own designation",
    after.json?.data?.profile?.designation === "Coordinator", after.json?.data?.profile?.designation);

  /* ---------- the reporting list ---------- */
  check("an employee has no reporting list", (after.json?.data?.reporting ?? []).length === 0);
  const mgrProfile = await call(hr, "/api/me/profile", null, "GET");
  check("HR's profile loads its own reporting list", mgrProfile.status === 200, `status=${mgrProfile.status}`);

  /* ---------- the page ---------- */
  await emp.goto(`${lab.base}/profile`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await wait(3000);
  const body = await emp.textContent("body");
  check("the page shows the personal section", /PERSONAL/.test(body) && /Marital status/.test(body));
  check("it shows employment", /EMPLOYMENT/.test(body) && /Hyderabad/.test(body) && /Delivery/.test(body));
  check("it shows the emergency contact", /Ravi Nair/.test(body));
  check("it surfaces the update request", /Update requested/.test(body));
  check("the photo can be changed", Boolean(await emp.$('button[aria-label="Change profile photo"]')));
  check("the menu is still there", /Attendance/.test(body) && /Sign out/.test(body));
  await shot(emp, "profile-page");
}

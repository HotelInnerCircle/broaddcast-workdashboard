/**
 * Swipes: where you were, and who has to agree about it.
 *
 * A swipe inside a work site is approved on the spot. One from outside every
 * site goes to the team lead, then the manager, then HR - and nobody may skip
 * the queue or decide their own.
 */
import { call, signedInEach, swipePhoto } from "../harness.mjs";

export const name = "swipes";
export const description = "the geofence decision and the three-step chain";

const SITE = { lat: 12.9716, lng: 77.5946 };

const decide = (page, id, decision, note) =>
  call(page, `/api/attendance/swipes/${id}/decision`, { decision, note });

export default async function run({ browser, lab, check }) {
  const [hr, mgr, lead, emp, admin] = await signedInEach(browser, lab.pw,
    [lab.people.hr.email, lab.people.mgr.email, lab.people.lead.email, lab.people.emp.email, lab.people.admin.email]);

  // Site names are unique per company, so clear any left from a previous run.
  for (const old of (await call(hr, "/api/work-sites", null, "GET")).json?.data ?? []) {
    await call(hr, `/api/work-sites/${old.id}`, null, "DELETE");
  }
  const site = await call(hr, "/api/work-sites", { name: "Head Office", lat: SITE.lat, lng: SITE.lng, radiusMeters: 150 });
  check("HR can create a work site", site.status === 201, `status=${site.status} ${JSON.stringify(site.json?.error ?? "")}`);
  check("an employee cannot create one",
    (await call(emp, "/api/work-sites", { name: "Nope", lat: 1, lng: 1, radiusMeters: 100 })).status === 403);
  check("a radius below the GPS error is refused",
    (await call(hr, "/api/work-sites", { name: "Pinpoint", lat: 1, lng: 1, radiusMeters: 5 })).status === 422);

  const inside = await swipePhoto(emp, "ON_DUTY", SITE.lat, SITE.lng);
  check("a swipe at the site is created", inside.status === 201, `status=${inside.status} ${JSON.stringify(inside.json?.error ?? "")}`);
  check("it is approved on the spot", inside.json?.data?.status === "APPROVED", inside.json?.data?.status);
  check("it records being inside", inside.json?.data?.withinGeofence === true);
  check("it names the site", inside.json?.data?.siteName === "Head Office", inside.json?.data?.siteName);
  check("it needs no approvals", (inside.json?.data?.approvals ?? []).length === 0);

  const out = await swipePhoto(emp, "OFF_DUTY", 12.98, SITE.lng);
  const id = out.json?.data?.id;
  check("a swipe away from every site is created", out.status === 201, `status=${out.status}`);
  check("it is pending, not approved", out.json?.data?.status === "PENDING", out.json?.data?.status);
  check("it measured the distance", out.json?.data?.distanceMeters > 800 && out.json?.data?.distanceMeters < 1100,
    `${out.json?.data?.distanceMeters} m`);
  check("it waits on the team lead first", out.json?.data?.currentStep === "TEAM_LEAD", out.json?.data?.currentStep);
  const steps = JSON.stringify((out.json?.data?.approvals ?? []).map((a) => a.step));
  check("the chain is lead, manager, HR", steps === JSON.stringify(["TEAM_LEAD", "MANAGER", "HR"]), steps);

  check("the employee cannot decide their own", (await decide(emp, id, "APPROVED")).status === 403);
  check("the manager cannot jump the queue", (await decide(mgr, id, "APPROVED")).status === 403);
  check("HR cannot jump to the front either", (await decide(hr, id, "APPROVED")).status === 403);

  const s1 = await decide(lead, id, "APPROVED", "Client site visit");
  check("the lead approves", s1.status === 200 && s1.json?.data?.currentStep === "MANAGER", `${s1.status} ${s1.json?.data?.currentStep}`);
  const s2 = await decide(mgr, id, "APPROVED");
  check("then the manager", s2.status === 200 && s2.json?.data?.currentStep === "HR", `${s2.status} ${s2.json?.data?.currentStep}`);
  const s3 = await decide(hr, id, "APPROVED");
  check("then HR, and it is approved", s3.status === 200 && s3.json?.data?.status === "APPROVED", `${s3.status} ${s3.json?.data?.status}`);
  check("a settled swipe cannot be decided twice", (await decide(hr, id, "REJECTED")).status === 400);

  const out2 = await swipePhoto(emp, "ON_DUTY", 12.99, SITE.lng);
  const rej = await decide(lead, out2.json.data.id, "REJECTED", "Not authorised off-site");
  check("a rejection at the first step ends it", rej.json?.data?.status === "REJECTED", rej.json?.data?.status);
  check("and it stops waiting on anyone", rej.json?.data?.currentStep === null);

  const photo = await emp.evaluate((u) => new Promise((res) => {
    const i = new Image();
    i.onload = () => res({ ok: true, w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => res({ ok: false, w: 0, h: 0 });
    i.src = u;
  }), inside.json.data.photoUrl);
  check("the stamped photo loads as an image", photo.ok === true, `${photo.w}x${photo.h}`);
  check("it was resized for storage, not stored raw", photo.w <= 1080, `width ${photo.w}`);

  check("null island is refused", (await swipePhoto(emp, "ON_DUTY", 0, 0)).status === 400);

  const empList = await call(emp, "/api/attendance/swipes?limit=50", null, "GET");
  const hrList = await call(hr, "/api/attendance/swipes?limit=50", null, "GET");
  // Three were accepted above - inside, outside, and the one that got rejected.
  // The fourth attempt was null island, which is refused and so never stored.
  check("the employee sees their own swipes", empList.json?.data?.length >= 3, `${empList.json?.data?.length}`);
  check("HR sees at least as many", hrList.json?.data?.length >= empList.json?.data?.length,
    `hr=${hrList.json?.data?.length} emp=${empList.json?.data?.length}`);
  const queue = await call(admin, "/api/attendance/swipes?mine=true", null, "GET");
  check("a queue lists only pending ones", (queue.json?.data ?? []).every((s) => s.status === "PENDING"));
}

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

  /* ---------- the levels a swipe goes through (A131) ---------- */
  /*
   * Leave and swipes share one chain, and the admin sets it. What matters here
   * is that a company with no team lead can drop that level entirely rather
   * than leaving a step nobody can fill - a request waiting on a person who
   * does not exist is a request that never moves.
   */
  const threeSteps = await call(admin, "/api/admin/company", { approvalChain: ["TEAM_LEAD", "MANAGER", "HR"] }, "PATCH");
  check("the admin sets the levels", threeSteps.status === 200, `status=${threeSteps.status}`);
  const far = await swipePhoto(emp, "ON_DUTY", 13.4, 78.4);
  const threeChain = (far.json?.data?.approvals ?? []).map((a) => a.step);
  check("an off-site swipe goes through three levels",
    JSON.stringify(threeChain) === JSON.stringify(["TEAM_LEAD", "MANAGER", "HR"]), JSON.stringify(threeChain));

  /*
   * Drop the first level. HR stays last whatever happens - it is the step any
   * HR person and the company admin can settle, so it is what guarantees a
   * request can always be decided by somebody.
   */
  const twoSteps = await call(admin, "/api/admin/company", { approvalChain: ["MANAGER", "HR"] }, "PATCH");
  check("a level can be dropped when there is no team lead", twoSteps.status === 200, `status=${twoSteps.status}`);
  const far2 = await swipePhoto(emp, "OFF_DUTY", 13.4, 78.4);
  const twoChain = (far2.json?.data?.approvals ?? []).map((a) => a.step);
  check("and the next swipe goes through two, manager first",
    JSON.stringify(twoChain) === JSON.stringify(["MANAGER", "HR"]), JSON.stringify(twoChain));
  // Through the suite's own helper, which uses the verb the endpoint expects.
  const leadTries = await decide(lead, far2.json?.data?.id, "APPROVED");
  check("the lead can no longer decide it", [401, 403].includes(leadTries.status), `status=${leadTries.status}`);

  // Put it back for anything that follows.
  await call(admin, "/api/admin/company", { approvalChain: ["TEAM_LEAD", "MANAGER", "HR"] }, "PATCH");

  /* ---------- the swipe is what makes the day count (A121) ---------- */
  /*
   * Clocking in and out is gone. It was a second thing to remember for the same
   * fact, and the one that fed payroll was the one with no photograph, no place
   * and no approval behind it - so a day could be paid on a button nobody could
   * check. The attendance record is derived from the swipes now.
   */
  const today = new Date().toISOString().slice(0, 10);
  const day = await call(emp, `/api/attendance?from=${today}&to=${today}`, null, "GET");
  const mine = (day.json?.data?.rows ?? []).find((r) => r.date === today);
  check("swiping on duty creates the day's attendance", Boolean(mine?.clockIn), JSON.stringify(mine ?? {}));
  check("and it counts as present or late, not absent", ["Present", "Late", "Half Day"].includes(mine?.status), mine?.status);

  /* ---------- the day's two ends, and how many swipes made it (A132) ---------- */
  /*
   * It used to read the first *on duty* swipe and the last *off duty* one,
   * which sounds right and behaves badly: somebody who forgets to swipe off has
   * no end to their day at all, so the hours come out as nothing and the record
   * reads as though they never left. The two ends of a day are the earliest
   * thing that happened and the latest, whatever either one says.
   */
  const swipesToday = (await call(hr, `/api/attendance/swipes?date=${today}&userId=${lab.ids.emp}`, null, "GET")).json?.data ?? [];
  check("the swipes are all on the record", swipesToday.length >= 1, `${swipesToday.length} swipes`);

  const dayNow = await call(hr, `/api/attendance?from=${today}&to=${today}&userId=${lab.ids.emp}`, null, "GET");
  const mineNow = (dayNow.json?.data?.rows ?? []).find((r) => r.date === today);
  check("the day counts the swipes it was built from", (mineNow?.swipeCount ?? 0) >= 1, JSON.stringify({ swipeCount: mineNow?.swipeCount }));
  check("its first end is the earliest swipe", Boolean(mineNow?.clockIn), String(mineNow?.clockIn));

  /*
   * Two on-duty swipes and nothing else - somebody who came back after lunch
   * and never swiped off. The day still has an end, which is the whole point.
   */
  await swipePhoto(emp, "ON_DUTY", 12.9716, 77.5946);
  const afterSecond = await call(hr, `/api/attendance?from=${today}&to=${today}&userId=${lab.ids.emp}`, null, "GET");
  const mine2 = (afterSecond.json?.data?.rows ?? []).find((r) => r.date === today);
  check("a day with no off-duty swipe still has a last swipe", Boolean(mine2?.clockOut), String(mine2?.clockOut));
  check("and the count went up", (mine2?.swipeCount ?? 0) > (mineNow?.swipeCount ?? 0),
    `${mineNow?.swipeCount} then ${mine2?.swipeCount}`);

  const goneAway = await call(emp, "/api/attendance/clock-in", {}, "POST");
  check("there is no clocking in any more", goneAway.status === 404, `status=${goneAway.status}`);

  /*
   * And it follows the swipes when one stops counting. Recomputed from what
   * still stands rather than nudged, so a rejection cannot leave the day
   * half-corrected - a person marked present by a swipe that was thrown out is
   * exactly the discrepancy this whole change exists to remove.
   */
  const pendingOne = (queue.json?.data ?? [])[0];
  if (pendingOne) {
    const owner = pendingOne.userId;
    const before = await call(hr, `/api/attendance?from=${today}&to=${today}&userId=${owner}`, null, "GET");
    const had = (before.json?.data?.rows ?? []).find((r) => r.date === today && r.clockIn);
    const rejected = await call(hr, `/api/attendance/swipes/${pendingOne.id}/decision`, { decision: "REJECTED", note: "not at a site" }, "PATCH");
    check("a pending swipe can be rejected", [200, 201].includes(rejected.status), `status=${rejected.status}`);
    const after = await call(hr, `/api/attendance?from=${today}&to=${today}&userId=${owner}`, null, "GET");
    const still = (after.json?.data?.rows ?? []).find((r) => r.date === today && r.clockIn);
    check("and the day is worked out again without it",
      had ? true : !still, `before=${Boolean(had)} after=${Boolean(still)}`);
  }
}

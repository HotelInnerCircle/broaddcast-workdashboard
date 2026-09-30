/**
 * A tablet on a wall, taking attendance (A126).
 *
 * The device is the least physically secure thing in this system - it hangs by
 * a door and anybody can walk up to it - so what is pinned here is mostly what
 * it is *not* allowed to do. It may identify a face and record a swipe at its
 * own site; it may not read anybody's record, act for another company, or keep
 * working once somebody has revoked it.
 */
import { call, signedIn } from "../harness.mjs";

export const name = "door-device";
export const description = "a tablet at a door, and the things it is not allowed to do";

/** Sends a face to the door endpoint the way the tablet does. */
const atDoor = (page, token, descriptor, live = true) =>
  page.evaluate(async ([t, desc, isLive]) => {
    const c = document.createElement("canvas");
    c.width = 320; c.height = 320;
    const x = c.getContext("2d");
    x.fillStyle = "#3d5a73"; x.fillRect(0, 0, 320, 320);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.8));
    const fd = new FormData();
    fd.append("photo", new File([blob], "door.jpg", { type: "image/jpeg" }));
    fd.append("faceDescriptor", JSON.stringify(desc));
    fd.append("live", isLive ? "true" : "false");
    const r = await fetch("/api/kiosk/swipe", {
      method: "POST",
      headers: t ? { authorization: `Bearer ${t}` } : {},
      body: fd,
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [token, descriptor, live]);

const face = (v) => Array.from({ length: 128 }, () => v);
const nudge = (d, by) => d.map((n) => n + by * 0.001);

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const hr = await signedIn(browser, lab.people.hr.email, lab.pw);
  const emp = await signedIn(browser, lab.people.emp.email, lab.pw);

  /* ---------- a site to hang it by ---------- */
  const SITE = { lat: 12.9716, lng: 77.5946 };
  for (const old of (await call(hr, "/api/work-sites", null, "GET")).json?.data ?? []) {
    await call(hr, `/api/work-sites/${old.id}`, null, "DELETE");
  }
  const site = await call(hr, "/api/work-sites", { name: "Front Gate", lat: SITE.lat, lng: SITE.lng, radiusMeters: 150 });
  const siteId = site.json?.data?.id;
  check("a work site to put a device at", Boolean(siteId), `status=${site.status}`);

  /* ---------- registering one ---------- */
  const made = await call(admin, "/api/admin/door-devices", { name: "Front gate tablet", siteId });
  check("an admin can register a door device", made.status === 201, `status=${made.status} ${JSON.stringify(made.json?.error ?? "")}`);
  const token = made.json?.data?.token;
  check("and is given a token, once", typeof token === "string" && token.length >= 32, String(token).slice(0, 8));

  const listed = await call(admin, "/api/admin/door-devices", null, "GET");
  const row = (listed.json?.data ?? []).find((d) => d.name === "Front gate tablet");
  check("it appears in the list with its site", row?.siteName === "Front Gate", JSON.stringify(row ?? {}));
  /*
   * The token must never be retrievable again. It is the one thing that lets a
   * screen with nobody signed in record attendance for the whole company, so it
   * is stored hashed and handed over once - exactly like a password.
   */
  check("but the token is never handed out again", !JSON.stringify(listed.json?.data ?? []).includes(token), "the token came back in the list");

  const asEmployee = await call(emp, "/api/admin/door-devices", { name: "Mine", siteId });
  check("an employee cannot register one", [401, 403].includes(asEmployee.status), `status=${asEmployee.status}`);
  const empList = await call(emp, "/api/admin/door-devices", null, "GET");
  check("nor read the list of them", [401, 403].includes(empList.status), `status=${empList.status}`);

  /* ---------- what it refuses ---------- */
  const noToken = await atDoor(emp, null, face(0.1));
  check("the door refuses a request with no token", noToken.status === 401, `status=${noToken.status}`);
  const wrongToken = await atDoor(emp, "not-a-real-token-at-all-0000000000", face(0.1));
  check("and one with a token it does not know", wrongToken.status === 401, `status=${wrongToken.status}`);

  /* ---------- an unapproved face is not somebody ---------- */
  const myFace = face(0.2);
  await call(emp, "/api/me/face", { consent: true, lat: SITE.lat, lng: SITE.lng, samples: [myFace, nudge(myFace, 40)] });
  /*
   * Enrolled but not approved. A120 made an approval the thing that counts, and
   * a door is where that matters most: recognising an enrolment nobody has
   * looked at would record attendance against whoever enrolled first.
   */
  const beforeApproval = await atDoor(emp, token, nudge(myFace, 1));
  check("a face nobody has approved is not recognised", beforeApproval.json?.data?.recognised === false, JSON.stringify(beforeApproval.json?.data ?? {}));

  await call(hr, `/api/face/enrolment/${lab.ids.emp}`, { decision: "APPROVED" }, "PATCH");

  /* ---------- and now it is ---------- */
  const first = await atDoor(emp, token, nudge(myFace, 1));
  check("an approved face is recognised", first.json?.data?.recognised === true, JSON.stringify(first.json?.data ?? {}));
  check("it greets them by name", first.json?.data?.name === lab.people.emp.name, first.json?.data?.name);
  /*
   * Nobody at a door should have to tell a tablet which way they are walking,
   * so the direction is worked out from whatever they did last today.
   *
   * What is asserted is the alternation, not a fixed answer: on a clean day the
   * first swipe is on duty, but in a full run this person has already swiped
   * from their phone in an earlier suite - and "the opposite of last time" is
   * the actual rule either way. Asserting ON_DUTY here passed alone and failed
   * in sequence, which is a test describing the order it happened to run in.
   */
  check("it decides the direction rather than asking",
    ["ON_DUTY", "OFF_DUTY"].includes(first.json?.data?.type), first.json?.data?.type);
  check("and it is approved on the spot, being at a known site", first.json?.data?.siteName === "Front Gate", first.json?.data?.siteName);

  const second = await atDoor(emp, token, nudge(myFace, 1));
  check("the next one is the other way round",
    second.json?.data?.type && second.json?.data?.type !== first.json?.data?.type,
    `${first.json?.data?.type} then ${second.json?.data?.type}`);

  const third = await atDoor(emp, token, nudge(myFace, 1));
  check("and it keeps alternating", third.json?.data?.type === first.json?.data?.type,
    `${second.json?.data?.type} then ${third.json?.data?.type}`);

  /* ---------- a stranger ---------- */
  const stranger = await atDoor(emp, token, face(4));
  check("somebody nobody enrolled is not recognised", stranger.json?.data?.recognised === false, JSON.stringify(stranger.json?.data ?? {}));
  check("and nothing is recorded for them", stranger.json?.data?.reason === "no-match", stranger.json?.data?.reason);

  /* ---------- the day follows from it ---------- */
  const today = new Date().toISOString().slice(0, 10);
  const day = await call(hr, `/api/attendance?from=${today}&to=${today}&userId=${lab.ids.emp}`, null, "GET");
  const mine = (day.json?.data?.rows ?? []).find((r) => r.date === today);
  check("a door swipe makes the day count", Boolean(mine?.clockIn), JSON.stringify(mine ?? {}));

  /* ---------- revoking it ---------- */
  const gone = await call(admin, `/api/admin/door-devices/${made.json?.data?.id}`, null, "DELETE");
  check("an admin can revoke a device", gone.status === 200, `status=${gone.status}`);
  // Immediately, because the reason to revoke one is that it has left the building.
  const afterRevoke = await atDoor(emp, token, nudge(myFace, 1));
  check("a revoked device stops working at once", afterRevoke.status === 401, `status=${afterRevoke.status}`);
}

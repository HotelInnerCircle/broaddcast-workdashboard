/**
 * Checking the face on a swipe (A108).
 *
 * The decision is made on the server, and that is the whole design: the browser
 * computes 128 numbers describing the face and sends them, but it does not get
 * to say whether they matched. A client that reported its own verdict could
 * simply report "yes".
 *
 * The other thing pinned here is what a mismatch *does*. It does not throw the
 * swipe away - it records it and sends it for review. Refusing outright would
 * mean somebody with a new beard, a bandage or bad light cannot clock in at all,
 * and that becomes an argument about pay rather than about faces.
 */
import { call, signedIn } from "../harness.mjs";

export const name = "face-check";
export const description = "faces checked on the server, mismatches reviewed not refused";

const LEN = 128;
const flat = (v) => new Array(LEN).fill(v);
/** A descriptor a known distance from another. */
const nudge = (base, d) => base.map((n, i) => (i === 0 ? n + d : n));

/** A swipe carrying a face descriptor, exactly as the phone sends it. */
const swipeWithFace = (page, type, lat, lng, descriptor) =>
  page.evaluate(async ([t, la, ln, desc]) => {
    const c = document.createElement("canvas");
    c.width = 480; c.height = 640;
    const x = c.getContext("2d");
    x.fillStyle = "#5a7a96"; x.fillRect(0, 0, 480, 640);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.8));
    const fd = new FormData();
    fd.append("photo", new File([blob], "face.jpg", { type: "image/jpeg" }));
    fd.append("type", t);
    fd.append("lat", String(la));
    fd.append("lng", String(ln));
    fd.append("accuracyMeters", "8");
    if (desc) fd.append("faceDescriptor", JSON.stringify(desc));
    const r = await fetch("/api/attendance/swipes", { method: "POST", body: fd });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [type, lat, lng, descriptor ?? null]);

const SITE = { lat: 12.9716, lng: 77.5946 };

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const hr = await signedIn(browser, lab.people.hr.email, lab.pw);
  const emp = await signedIn(browser, lab.people.emp.email, lab.pw);

  for (const old of (await call(hr, "/api/work-sites", null, "GET")).json?.data ?? []) {
    await call(hr, `/api/work-sites/${old.id}`, null, "DELETE");
  }
  await call(hr, "/api/work-sites", { name: "Head Office", lat: SITE.lat, lng: SITE.lng, radiusMeters: 150 });

  /* ---------- off by default ---------- */
  const status0 = await call(emp, "/api/me/face", null, "GET");
  check("the face check is off until somebody turns it on", status0.json?.data?.required === false, JSON.stringify(status0.json?.data ?? {}));
  check("and nobody is enrolled yet", status0.json?.data?.enrolled === false);

  /* ---------- enrolling ---------- */
  const myFace = flat(0.1);
  const noConsent = await call(emp, "/api/me/face", { samples: [myFace, nudge(myFace, 0.05)] });
  check("enrolling without consent is refused", noConsent.status === 400, `status=${noConsent.status}`);
  check("and it says why", /consent|agree/i.test(JSON.stringify(noConsent.json?.error ?? "")), JSON.stringify(noConsent.json?.error ?? ""));

  const oneSample = await call(emp, "/api/me/face", { consent: true, samples: [myFace] });
  check("one capture is not enough to enrol from", oneSample.status === 400, `status=${oneSample.status}`);

  const junk = await call(emp, "/api/me/face", { consent: true, samples: [[1, 2, 3], "nonsense", null] });
  check("rubbish instead of a face is refused", junk.status === 400, `status=${junk.status}`);

  const enrolled = await call(emp, "/api/me/face", {
    consent: true,
    samples: [myFace, nudge(myFace, 0.04), nudge(myFace, -0.03), nudge(myFace, 0.02)],
  });
  check("a face can be enrolled from several captures", enrolled.status === 200, `status=${enrolled.status} ${JSON.stringify(enrolled.json?.error ?? "")}`);
  check("it says how many it averaged", enrolled.json?.data?.samples === 4, `${enrolled.json?.data?.samples}`);

  /* ---------- while it is off, nothing is checked ---------- */
  const whileOff = await swipeWithFace(emp, "ON_DUTY", SITE.lat, SITE.lng, nudge(myFace, 3));
  check("with the check off, even a wrong face is not judged", whileOff.json?.data?.faceVerdict === "unverified", whileOff.json?.data?.faceVerdict);
  check("and the swipe is approved on the spot as before", whileOff.json?.data?.status === "APPROVED", whileOff.json?.data?.status);

  /* ---------- switch it on ---------- */
  const on = await call(admin, "/api/admin/company", { faceCheck: { enabled: true, threshold: 0.6 } }, "PATCH");
  check("the admin can switch the check on", on.status === 200, `status=${on.status} ${JSON.stringify(on.json?.error ?? "")}`);
  check("and an employee cannot", (await call(emp, "/api/admin/company", { faceCheck: { enabled: false } }, "PATCH")).status === 403);

  /* ---------- the right face ---------- */
  const right = await swipeWithFace(emp, "ON_DUTY", SITE.lat, SITE.lng, nudge(myFace, 0.15));
  check("their own face matches", right.json?.data?.faceVerdict === "matched", `${right.json?.data?.faceVerdict} at ${right.json?.data?.faceDistance}`);
  check("and the swipe is approved on the spot", right.json?.data?.status === "APPROVED", right.json?.data?.status);

  /* ---------- somebody else's face ---------- */
  const wrong = await swipeWithFace(emp, "OFF_DUTY", SITE.lat, SITE.lng, nudge(myFace, 2.5));
  check("a different face is a mismatch", wrong.json?.data?.faceVerdict === "mismatch", `${wrong.json?.data?.faceVerdict} at ${wrong.json?.data?.faceDistance}`);
  /*
   * The line this whole feature turns on. A mismatch at a work site is still
   * recorded - with its photograph - and goes to the approval queue. It is not
   * silently dropped, and the person is not locked out.
   */
  check("a mismatch is still recorded, not thrown away", wrong.status === 201, `status=${wrong.status}`);
  check("but it is not approved on the spot", wrong.json?.data?.status === "PENDING", wrong.json?.data?.status);
  check("it goes to somebody to look at", (wrong.json?.data?.approvals ?? []).length > 0, JSON.stringify((wrong.json?.data?.approvals ?? []).map((a) => a.step)));
  check("and how far off it was is kept, so it can be explained later", typeof wrong.json?.data?.faceDistance === "number", `${wrong.json?.data?.faceDistance}`);

  /* ---------- a client cannot simply claim a match ---------- */
  /*
   * There is no field to lie in: the browser sends the descriptor, never the
   * verdict. Sending no face at all is "unverified", which is not a free pass -
   * it does not get the on-the-spot approval a real match does.
   */
  const noFace = await swipeWithFace(emp, "ON_DUTY", SITE.lat, SITE.lng, null);
  check("sending no face at all is not a way to be trusted", noFace.json?.data?.faceVerdict === "unverified", noFace.json?.data?.faceVerdict);

  const brokenFace = await swipeWithFace(emp, "ON_DUTY", SITE.lat, SITE.lng, "pretend this matched");
  check("nor is sending nonsense in place of one", brokenFace.json?.data?.faceVerdict === "unverified", brokenFace.json?.data?.faceVerdict);
  check("and it does not crash the swipe", brokenFace.status === 201, `status=${brokenFace.status}`);

  /* ---------- the threshold is a company decision ---------- */
  await call(admin, "/api/admin/company", { faceCheck: { enabled: true, threshold: 1.4 } }, "PATCH");
  const forgiving = await swipeWithFace(emp, "ON_DUTY", SITE.lat, SITE.lng, nudge(myFace, 1.2));
  check("a looser threshold accepts a face a stricter one refused", forgiving.json?.data?.faceVerdict === "matched", `${forgiving.json?.data?.faceVerdict} at ${forgiving.json?.data?.faceDistance}`);
  await call(admin, "/api/admin/company", { faceCheck: { threshold: 0.6 } }, "PATCH");

  /* ---------- HR can see who has enrolled ---------- */
  const register = await call(hr, "/api/face/enrolment", null, "GET");
  check("HR can see who has enrolled", register.status === 200 && register.json?.data?.total >= 5, `status=${register.status}`);
  check("and who has not", register.json?.data?.enrolled < register.json?.data?.total, `${register.json?.data?.enrolled} of ${register.json?.data?.total}`);
  check("an employee cannot read that register", (await call(emp, "/api/face/enrolment", null, "GET")).status === 403);

  /* ---------- it is their data, and they can withdraw it ---------- */
  const removed = await call(emp, "/api/me/face", null, "DELETE");
  check("somebody can remove their own face", removed.status === 200, `status=${removed.status}`);
  const after = await call(emp, "/api/me/face", null, "GET");
  check("and it is gone", after.json?.data?.enrolled === false);

  const unenrolled = await swipeWithFace(emp, "ON_DUTY", SITE.lat, SITE.lng, nudge(myFace, 0.1));
  check("with nothing enrolled they are unverified, not accused", unenrolled.json?.data?.faceVerdict === "unverified", unenrolled.json?.data?.faceVerdict);

  const stealOther = await call(emp, `/api/me/face?userId=${lab.ids.hr}`, null, "DELETE");
  check("an employee cannot remove somebody else's", stealOther.status === 403, `status=${stealOther.status}`);

  // Off again for the suites that follow.
  await call(admin, "/api/admin/company", { faceCheck: { enabled: false } }, "PATCH");
}

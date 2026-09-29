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

const TODAY = () => new Date().toISOString().slice(0, 10);

export const name = "face-check";
export const description = "faces checked on the server, mismatches reviewed not refused";

const LEN = 128;
const flat = (v) => new Array(LEN).fill(v);
/** A descriptor a known distance from another. */
const nudge = (base, d) => base.map((n, i) => (i === 0 ? n + d : n));

/** A swipe carrying a face descriptor, exactly as the phone sends it. */
const swipeWithFace = (page, type, lat, lng, descriptor, attempts) =>
  page.evaluate(async ([t, la, ln, desc, tries]) => {
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
    if (tries !== undefined && tries !== null) fd.append("faceAttempts", String(tries));
    const r = await fetch("/api/attendance/swipes", { method: "POST", body: fd });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [type, lat, lng, descriptor ?? null, attempts ?? null]);

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

  const oneSample = await call(emp, "/api/me/face", { consent: true, lat: SITE.lat, lng: SITE.lng, samples: [myFace] });
  check("one capture is not enough to enrol from", oneSample.status === 400, `status=${oneSample.status}`);

  const junk = await call(emp, "/api/me/face", { consent: true, lat: SITE.lat, lng: SITE.lng, samples: [[1, 2, 3], "nonsense", null] });
  check("rubbish instead of a face is refused", junk.status === 400, `status=${junk.status}`);

  /* ---------- it has to be done at a work site (A120) ---------- */
  /*
   * The easiest way to enrol somebody else's face is from a sofa, and the phone
   * already knows where it is. Enforced only where work sites exist, so a
   * company that has not drawn any is not locked out of its own feature.
   */
  const fromHome = await call(emp, "/api/me/face", {
    consent: true, lat: 13.2, lng: 77.9,
    samples: [myFace, nudge(myFace, 0.04), nudge(myFace, -0.03), nudge(myFace, 0.02)],
  });
  check("enrolling away from every site is refused", fromHome.status === 400 && fromHome.json?.error?.code === "OUTSIDE_SITE",
    `status=${fromHome.status} ${JSON.stringify(fromHome.json?.error ?? {})}`);

  const noWhere = await call(emp, "/api/me/face", {
    consent: true,
    samples: [myFace, nudge(myFace, 0.04), nudge(myFace, -0.03), nudge(myFace, 0.02)],
  });
  check("and so is enrolling with the location withheld", noWhere.status === 400 && noWhere.json?.error?.code === "NO_LOCATION",
    `status=${noWhere.status} ${JSON.stringify(noWhere.json?.error ?? {})}`);

  const enrolled = await call(emp, "/api/me/face", {
    consent: true, lat: SITE.lat, lng: SITE.lng,
    samples: [myFace, nudge(myFace, 0.04), nudge(myFace, -0.03), nudge(myFace, 0.02)],
  });
  check("a face can be enrolled from several captures", enrolled.status === 200, `status=${enrolled.status} ${JSON.stringify(enrolled.json?.error ?? "")}`);

  /* ---------- nothing counts until somebody has agreed to it (A120) ---------- */
  /*
   * The hole this closes: whoever held the phone at enrolment became that
   * account's face for ever, and every swipe afterwards reported "verified".
   * That is worse than no check, because it manufactures a record that reads
   * like evidence. A person who can recognise the employee has to say so.
   */
  check("a fresh enrolment is pending, not live", enrolled.json?.data?.approval === "pending", JSON.stringify(enrolled.json?.data ?? {}));

  const mineNow = await call(emp, "/api/me/face", null, "GET");
  check("and the person is told it is waiting", mineNow.json?.data?.approval === "pending", mineNow.json?.data?.approval);

  await call(admin, "/api/admin/company", { faceCheck: { enabled: true } }, "PATCH");
  const beforeApproval = await swipeWithFace(emp, "ON_DUTY", SITE.lat, SITE.lng, nudge(myFace, 0.15), 0);
  check("an unapproved face is unverified, not matched", beforeApproval.json?.data?.faceVerdict === "unverified", beforeApproval.json?.data?.faceVerdict);
  // Unverified, never refused: somebody waiting on HR's queue has done nothing
  // wrong and must not be stopped from clocking in over it.
  check("but they are not stopped from swiping", beforeApproval.status === 201, `status=${beforeApproval.status}`);
  await call(admin, "/api/admin/company", { faceCheck: { enabled: false } }, "PATCH");

  const waitingRegister = await call(hr, "/api/face/enrolment", null, "GET");
  const waiting = (waitingRegister.json?.data?.rows ?? []).find((r) => r.userId === lab.ids.emp);
  check("HR sees it waiting in the register", waiting?.approval === "pending", JSON.stringify(waiting ?? {}));
  check("and the register counts what is pending", waitingRegister.json?.data?.pending >= 1, `${waitingRegister.json?.data?.pending}`);

  const selfApprove = await call(emp, `/api/face/enrolment/${lab.ids.emp}`, { decision: "APPROVED" }, "PATCH");
  check("an employee cannot approve anybody, least of all themselves", [401, 403].includes(selfApprove.status), `status=${selfApprove.status}`);

  const approve = await call(hr, `/api/face/enrolment/${lab.ids.emp}`, { decision: "APPROVED" }, "PATCH");
  check("HR can approve it", approve.status === 200, `status=${approve.status} ${JSON.stringify(approve.json?.error ?? "")}`);
  check("and it is approved now", approve.json?.data?.approval === "approved", JSON.stringify(approve.json?.data ?? {}));

  const twice = await call(hr, `/api/face/enrolment/${lab.ids.emp}`, { decision: "APPROVED" }, "PATCH");
  check("deciding twice is refused", twice.status === 400, `status=${twice.status}`);
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

  /* ---------- somebody else's face: asked to try again first (A116) ---------- */
  /*
   * A face that does not match asks for another photograph rather than being
   * filed straight away. Somebody half in shadow took a bad picture rather than
   * committed a fraud, and the honest answer is "take it again" - which is what
   * the owner asked for and what `maxRetries` was sitting in the settings for,
   * unread, since the check was built.
   *
   * Nothing is stored on a refused try: no swipe row, and no photograph either,
   * which at three tries each would otherwise cost more than the swipes.
   */
  const first = await swipeWithFace(emp, "OFF_DUTY", SITE.lat, SITE.lng, nudge(myFace, 2.5), 0);
  check("a wrong face is refused rather than recorded", first.status === 400, `status=${first.status}`);
  check("and it is named as a mismatch, not a vague failure", first.json?.error?.code === "FACE_MISMATCH", JSON.stringify(first.json?.error ?? {}));
  check("it says to take the photo again", /take the photo again/i.test(first.json?.error?.message ?? ""), first.json?.error?.message);
  check("and says which try this was", first.json?.error?.details?.attempts === 1 && first.json?.error?.details?.maxRetries === 3,
    JSON.stringify(first.json?.error?.details ?? {}));

  const second = await swipeWithFace(emp, "OFF_DUTY", SITE.lat, SITE.lng, nudge(myFace, 2.5), 1);
  check("a second wrong try is refused too", second.status === 400, `status=${second.status}`);
  check("counting up as it goes", second.json?.error?.details?.attempts === 2, JSON.stringify(second.json?.error?.details ?? {}));

  const before = await call(emp, `/api/attendance/swipes?date=${TODAY()}`, null, "GET");
  const refusedRows = (before.json?.data ?? []).filter((r) => r.faceVerdict === "mismatch").length;
  check("nothing was recorded by the refused tries", refusedRows === 0, `${refusedRows} mismatch rows`);

  /*
   * The last try goes through. Refusing for ever would mean somebody with a new
   * beard, a bandage or bad light cannot clock in, and that becomes an argument
   * about pay - the one thing this must never cause. It is recorded, marked,
   * and sent to a person to look at.
   */
  const wrong = await swipeWithFace(emp, "OFF_DUTY", SITE.lat, SITE.lng, nudge(myFace, 2.5), 2);
  check("the last allowed try is recorded, not thrown away", wrong.status === 201, `status=${wrong.status}`);
  check("a different face is a mismatch", wrong.json?.data?.faceVerdict === "mismatch", `${wrong.json?.data?.faceVerdict} at ${wrong.json?.data?.faceDistance}`);
  check("but it is not approved on the spot", wrong.json?.data?.status === "PENDING", wrong.json?.data?.status);
  check("it goes to somebody to look at", (wrong.json?.data?.approvals ?? []).length > 0, JSON.stringify((wrong.json?.data?.approvals ?? []).map((a) => a.step)));
  check("and how far off it was is kept, so it can be explained later", typeof wrong.json?.data?.faceDistance === "number", `${wrong.json?.data?.faceDistance}`);
  check("how many tries it took is kept too", wrong.json?.data?.faceAttempts === 2, `${wrong.json?.data?.faceAttempts}`);

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

  /* ---------- re-enrolling sends it back to the queue (A120) ---------- */
  /*
   * Otherwise the approval is theatre: enrol your own face, have it approved,
   * then quietly replace it with somebody else's and keep the tick.
   */
  const again = await call(emp, "/api/me/face", { consent: true, lat: SITE.lat, lng: SITE.lng, samples: [myFace, nudge(myFace, 0.05)] });
  check("enrolling again is allowed", again.status === 200, `status=${again.status}`);
  check("but it goes back to pending", again.json?.data?.approval === "pending", JSON.stringify(again.json?.data ?? {}));
  const reapprove = await call(hr, `/api/face/enrolment/${lab.ids.emp}`, { decision: "APPROVED" }, "PATCH");
  check("and has to be approved again", reapprove.status === 200, `status=${reapprove.status}`);

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

  /* ---------- the model download, when the connection is against you ---------- */
  /*
   * The weights are 6.5 MB and on mobile data that is a minute or more (A113).
   * Three things went wrong there and none of them were visible from the API:
   *
   * - the screen showed one unchanging line, so a slow download and a broken
   *   one looked identical and people closed the app;
   * - a failed load was cached, so pressing the button again replayed the same
   *   failure without attempting anything - the only cure was a full reload;
   * - the error said the camera could not be opened, sending somebody to check
   *   the wrong thing entirely.
   *
   * Driven through the real screen with the network cut, because none of it can
   * be reached from an HTTP call.
   */
  const page = emp;
  await page.context().grantPermissions(["camera"]).catch(() => {});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");

  await page.goto(`${lab.base}/profile`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const card = await page.waitForSelector("text=Face check", { timeout: 30_000 }).then(() => true).catch(() => false);
  check("the enrolment card is on the profile", card);

  if (card) {
    await page.click('input[type="checkbox"]').catch(() => {});

    await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await page.click('button:has-text("Enrol my face")');
    const complaint = await page.waitForSelector("text=/could not be downloaded|taking too long/", { timeout: 60_000 })
      .then((el) => el.textContent()).catch(() => null);
    check("a model that will not download says so", Boolean(complaint), complaint ?? "(no message appeared)");
    check("and does not blame the camera", !/camera/i.test(complaint ?? ""), complaint ?? "");

    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.click('button:has-text("Enrol my face")');
    const recovered = await page.waitForSelector("text=/Look at the camera|Getting the face model ready - /", { timeout: 90_000 })
      .then(() => true).catch(() => false);
    // The point of the check: the first failure must not be remembered. It was,
    // and pressing the button again did nothing at all until the page reloaded.
    check("trying again after a failure really tries again", recovered);

    /*
     * And Capture has to come back (A115).
     *
     * The reported symptom was a Capture button spinning for ever with the
     * camera already open and the model already downloaded - the face read
     * itself never returned, so `setBusy(false)` never ran and the only way out
     * was to kill the app. What is asserted is not that a face is found (there
     * is no face in a synthetic camera) but that an answer of any kind arrives
     * and the button is usable again.
     */
    const cameraUp = await page.waitForSelector("text=Look at the camera", { timeout: 120_000 })
      .then(() => true).catch(() => false);
    check("the camera opens after the model is ready", cameraUp);

    if (cameraUp) {
      const began = Date.now();
      await page.click('button:has-text("Capture")');
      const answered = await page.waitForSelector("text=/No face found|Come a little closer|could not be read|struggling to read|Good\\.|That is enough/", { timeout: 60_000 })
        .then((el) => el.textContent()).catch(() => null);
      check("Capture always comes back with an answer", Boolean(answered),
        answered ?? `nothing after ${((Date.now() - began) / 1000).toFixed(0)}s`);

      const stuck = await page.$('button:has-text("Capture")[disabled]');
      check("and the button is usable again afterwards", !stuck);
    }
  }

  // Off again for the suites that follow.
  await call(admin, "/api/admin/company", { faceCheck: { enabled: false } }, "PATCH");
}

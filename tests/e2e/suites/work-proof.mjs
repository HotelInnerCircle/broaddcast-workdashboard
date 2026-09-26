/**
 * A picture of the work, required when the company asks (A105).
 *
 * The interesting check is the last group. Switching timers closes the running
 * one, so "start something else" was a way to end a timer without ever attaching
 * a picture - a requirement with a way around it is not a requirement. Switching
 * is refused while a picture is required, and that is asserted here rather than
 * trusted.
 */
import { call, shot, signedIn, stopTimerWithProof, submitDailyReportWithProof, wait, waitForText } from "../harness.mjs";

/** Built from a string so a layer of shell quoting cannot eat the escape. */
const WHITESPACE = new RegExp("\\s+", "g");

export const name = "work-proof";
export const description = "a picture of the work, and no way round it";

const TODAY = () => new Date().toISOString().slice(0, 10);

/** Stop with no picture at all - what an old client would send. */
const stopWithoutProof = (page, notes) => call(page, "/api/timer/stop", { notes });

/** Multipart, but with the picture left out. */
const stopWithEmptyForm = (page, notes) =>
  page.evaluate(async ([text]) => {
    const fd = new FormData();
    fd.append("notes", text);
    const r = await fetch("/api/timer/stop", { method: "POST", body: fd });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [notes]);

/** A text file renamed to .jpg - the header sniff should catch it. */
const stopWithFakeImage = (page, notes) =>
  page.evaluate(async ([text]) => {
    const fd = new FormData();
    fd.append("notes", text);
    fd.append("proof", new File([new Blob(["not an image at all"])], "work.jpg", { type: "image/jpeg" }));
    const r = await fetch("/api/timer/stop", { method: "POST", body: fd });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [notes]);

export default async function run({ browser, lab, check }) {
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const emp = await signedIn(browser, lab.people.emp.email, lab.pw);
  const hr = await signedIn(browser, lab.people.hr.email, lab.pw);

  const client = await call(admin, "/api/clients", { name: "Proof Co" });
  let clientId = client.json?.data?.id;
  if (client.status === 409) {
    const list = await call(admin, "/api/clients?limit=100", null, "GET");
    clientId = (list.json?.data ?? []).find((c) => c.name === "Proof Co")?.id;
  }
  check("a client to track against", Boolean(clientId), `status=${client.status}`);
  if (!clientId) return;

  await call(admin, "/api/admin/company", { workProof: { timer: true, dailyReport: true } }, "PATCH");
  await call(emp, "/api/attendance/clock-in", {});
  await stopTimerWithProof(emp, "clearing the decks");

  /* ---------- a timer cannot be stopped without one ---------- */
  await call(emp, "/api/timer/start", { clientId, notes: "Proof required", force: false });
  const bare = await stopWithoutProof(emp, "done it");
  check("stopping with no picture is refused", bare.status === 400, `status=${bare.status}`);
  check("and it says a picture is needed", /picture/i.test(JSON.stringify(bare.json?.error ?? "")), JSON.stringify(bare.json?.error ?? ""));

  const empty = await stopWithEmptyForm(emp, "done it");
  check("an upload with the picture left out is refused too", empty.status === 400, `status=${empty.status}`);

  const fake = await stopWithFakeImage(emp, "done it");
  check("a file that only claims to be an image is refused", fake.status === 400, `status=${fake.status}`);

  /* ---------- and switching is not a way round it ---------- */
  const switched = await call(emp, "/api/timer/start", { clientId, notes: "Sneaking past", force: true, previousNotes: "done it" });
  check("switching timers cannot be used to end one without a picture", switched.status === 400, `status=${switched.status}`);
  check("and it says to stop it properly", /stop the running timer/i.test(JSON.stringify(switched.json?.error ?? "")), JSON.stringify(switched.json?.error ?? ""));

  const still = await call(emp, "/api/timer", null, "GET");
  check("the timer is still running after all that", Boolean(still.json?.data?.entry), JSON.stringify(still.json?.data?.entry ?? null).slice(0, 80));

  /* ---------- with a picture it works ---------- */
  const good = await stopTimerWithProof(emp, "Finished the proof work");
  check("stopping with a picture works", good.status === 200, `status=${good.status} ${JSON.stringify(good.json?.error ?? "")}`);

  const today = TODAY();
  const entries = await call(emp, `/api/time-entries?from=${today}&to=${today}&userId=${lab.ids.emp}`, null, "GET");
  const withProof = (entries.json?.data?.entries ?? []).find((e) => e.notes === "Finished the proof work");
  check("the entry records that it has one", withProof?.hasProof === true, JSON.stringify(withProof ?? null).slice(0, 120));

  /* ---------- the picture can be looked at, by the right people ---------- */
  const link = await call(emp, `/api/work-proof/timer/${withProof.id}`, null, "GET");
  check("they can open their own picture", link.status === 200 && Boolean(link.json?.data?.url), `status=${link.status}`);
  const asHr = await call(hr, `/api/work-proof/timer/${withProof.id}`, null, "GET");
  check("HR can open it too", asHr.status === 200, `status=${asHr.status}`);
  /*
   * Checked the other way round on purpose. The team lead *can* see the
   * employee's picture - the employee is in their team, which is what the people
   * scope means. The case worth proving is the one that must not work: an
   * employee, whose scope is themselves alone, reaching somebody else's.
   */
  const lead = await signedIn(browser, lab.people.lead.email, lab.pw);
  await call(lead, "/api/attendance/clock-in", {});
  await call(lead, "/api/timer/start", { clientId, notes: "Lead's own work", force: false });
  const leadStop = await stopTimerWithProof(lead, "Lead's own work");
  check("the lead records a picture of their own", leadStop.status === 200, `status=${leadStop.status}`);
  const leadEntries = await call(lead, `/api/time-entries?from=${TODAY()}&to=${TODAY()}&userId=${lab.ids.lead}`, null, "GET");
  const leadEntry = (leadEntries.json?.data?.entries ?? []).find((e) => e.hasProof);
  const stolen = await call(emp, `/api/work-proof/timer/${leadEntry?.id}`, null, "GET");
  check("an employee cannot open somebody else's picture", [403, 404].includes(stolen.status), `status=${stolen.status}`);
  check("while the lead can open their own", (await call(lead, `/api/work-proof/timer/${leadEntry?.id}`, null, "GET")).status === 200);

  /* ---------- the daily report asks for one too ---------- */
  /*
   * Filed as the manager, who no other suite writes a report for. Using the
   * employee made this pass or fail depending on whether the reports suite had
   * already filed one for them today - and a report that *already* has a picture
   * is correctly allowed to be edited without another, so the check was testing
   * the order the suites happened to run in.
   */
  const mgr = await signedIn(browser, lab.people.mgr.email, lab.pw);
  const noPic = await call(mgr, "/api/daily-reports", { date: today, completed: "Did the work" });
  check("a first daily report with no picture is refused", noPic.status === 400, `status=${noPic.status}`);
  const withPic = await submitDailyReportWithProof(mgr, { date: today, completed: "Did the work, here is the proof" });
  check("with one it is accepted", withPic.status === 200, `status=${withPic.status} ${JSON.stringify(withPic.json?.error ?? "")}`);
  const edited = await call(mgr, "/api/daily-reports", { date: today, completed: "Refined the wording later" });
  check("editing it again does not demand a second picture", edited.status === 200, `status=${edited.status}`);

  /* ---------- and the company can switch it off ---------- */
  await call(admin, "/api/admin/company", { workProof: { timer: false, dailyReport: false } }, "PATCH");
  await wait(300);
  await call(emp, "/api/timer/start", { clientId, notes: "No proof needed now", force: false });
  const relaxed = await stopWithoutProof(emp, "stopped without one");
  check("with the setting off, no picture is needed", relaxed.status === 200, `status=${relaxed.status}`);
  const switchNow = await call(emp, "/api/timer/start", { clientId, notes: "switching", force: true, previousNotes: "prev" });
  check("and switching works again", [200, 201].includes(switchNow.status), `status=${switchNow.status}`);
  await call(emp, "/api/timer/stop", { notes: "tidy up" });

  // Back on for anything that follows.
  await call(admin, "/api/admin/company", { workProof: { timer: true, dailyReport: true } }, "PATCH");

  /* ---------- the phone home leads with today's swipes, not the timer (A106) ---------- */
  const phone = await signedIn(browser, lab.people.emp.email, lab.pw, { mobile: true });
  await phone.goto(`${lab.base}/employee/dashboard`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const shown = await waitForText(phone, /TODAY.S SWIPES/i, 30_000);
  check("the phone home leads with today's swipes", shown, "the card never appeared");
  const home = (await phone.textContent("body")) ?? "";
  check("and no longer with the running timer", !/No timer running/i.test(home));
  check("it says how many there are", /today|None yet/i.test(home), home.replace(WHITESPACE, " ").slice(0, 160));
  await shot(phone, "mobile-home-swipes");
}

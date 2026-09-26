/**
 * Leave: the six types, the balance, the chain, and what History shows.
 *
 * Leave and swipes share `services/approvalChain.ts`, so the chain is checked
 * here as well - if one of them ever stops matching the other, the two suites
 * disagree and say so.
 */
import { call, form, signedInEach, shot, wait, waitForText, signedIn } from "../harness.mjs";

export const name = "leave";
export const description = "the six types, the balance, and the approval chain";

const apply = (page, type, startDate, endDate, note) =>
  form(page, "/api/leave", { type, startDate, endDate, ...(note ? { note } : {}) });

/** A Monday some weeks out, so a range never lands on a weekend. */
const monday = (weeksAhead) => {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7) + weeksAhead * 7);
  return d.toISOString().slice(0, 10);
};

export default async function run({ browser, lab, check }) {
  const [hr, mgr, lead, emp] = await signedInEach(browser, lab.pw,
    [lab.people.hr.email, lab.people.mgr.email, lab.people.lead.email, lab.people.emp.email]);

  const year = new Date().getFullYear();
  const setPl = await call(hr, "/api/leave/policies", { type: "PL", year, daysPerYear: 12 }, "PUT");
  check("HR can set an allowance", setPl.status === 200, `status=${setPl.status} ${JSON.stringify(setPl.json?.error ?? "")}`);
  await call(hr, "/api/leave/policies", { type: "CL", year, daysPerYear: 12 }, "PUT");
  await call(hr, "/api/leave/policies", { type: "SL", year, daysPerYear: 12 }, "PUT");
  check("an employee cannot",
    (await call(emp, "/api/leave/policies", { type: "PL", year, daysPerYear: 99 }, "PUT")).status === 403);

  const bal = await call(emp, "/api/leave/balance", null, "GET");
  const pl = (bal.json?.data ?? []).find((b) => b.type === "PL");
  check("the balance accrues month by month", pl && pl.accrued > 0 && pl.accrued <= 12, `accrued=${pl?.accrued} of 12`);

  const day1 = monday(1);
  const made = await apply(emp, "PL", day1, day1, "Family function");
  check("an employee can apply", made.status === 201, `status=${made.status} ${JSON.stringify(made.json?.error ?? "")}`);
  const id = made.json?.data?.id;
  check("it counts working days only", made.json?.data?.days === 1, `days=${made.json?.data?.days}`);
  check("it starts as pending", made.json?.data?.status === "PENDING", made.json?.data?.status);
  check("the chain is lead, manager, HR",
    JSON.stringify((made.json?.data?.approvals ?? []).map((x) => x.step)) === JSON.stringify(["TEAM_LEAD", "MANAGER", "HR"]));
  check("overlapping dates are refused", (await apply(emp, "CL", day1, day1)).status === 409);
  check("a backwards range is refused", (await apply(emp, "CL", monday(4), monday(3))).status === 400);

  check("the employee cannot approve their own",
    (await call(emp, `/api/leave/${id}/decision`, { decision: "APPROVED" })).status === 403);
  check("the manager cannot jump the queue",
    (await call(mgr, `/api/leave/${id}/decision`, { decision: "APPROVED" })).status === 403);
  const s1 = await call(lead, `/api/leave/${id}/decision`, { decision: "APPROVED" });
  check("the lead approves", s1.status === 200 && s1.json?.data?.currentStep === "MANAGER", `${s1.status} ${s1.json?.data?.currentStep}`);
  const s2 = await call(mgr, `/api/leave/${id}/decision`, { decision: "APPROVED" });
  check("then the manager", s2.json?.data?.currentStep === "HR", s2.json?.data?.currentStep);
  const s3 = await call(hr, `/api/leave/${id}/decision`, { decision: "APPROVED" });
  check("then HR, and it is approved", s3.json?.data?.status === "APPROVED", s3.json?.data?.status);

  const after = await call(emp, "/api/leave/balance", null, "GET");
  const pl2 = (after.json?.data ?? []).find((x) => x.type === "PL");
  check("the approved day comes off the balance", pl2?.taken === 1, `taken=${pl2?.taken}, remaining ${pl?.remaining} -> ${pl2?.remaining}`);

  const r2 = await apply(emp, "CL", monday(2), monday(2));
  const rej = await call(lead, `/api/leave/${r2.json.data.id}/decision`, { decision: "REJECTED", note: "Busy week" });
  check("a rejection ends it", rej.json?.data?.status === "REJECTED", rej.json?.data?.status);
  const r3 = await apply(emp, "SL", monday(3), monday(3));
  check("you can withdraw your own pending plan",
    (await call(emp, `/api/leave/${r3.json.data.id}/cancel`)).json?.data?.status === "CANCELLED");

  await emp.goto(`${lab.base}/leave`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await wait(2500);
  const opts = await emp.$$eval('select[aria-label="Leave type"] option', (o) => o.map((x) => x.value).filter(Boolean));
  check("all six leave types are offered",
    JSON.stringify(opts) === JSON.stringify(["PL", "CL", "SL", "COMP_OFF", "LOP", "ON_DUTY"]), JSON.stringify(opts));
  await shot(emp, "leave-create");

  await emp.click('button:has-text("History")');
  // Waiting for the rows rather than for a guessed second and a half: the tab
  // fetches its own history, and a slower run outran the sleep.
  const history = await waitForText(emp, /Privilege Leave/, 30_000);
  const body = await emp.textContent("body");
  check("History shows approved and rejected", history && /Approved/.test(body) && /Rejected/.test(body), history ? "" : "no rows appeared");
  check("it names the leave types", /Privilege Leave/.test(body) && /Casual Leave/.test(body));
  await shot(emp, "leave-history");

  await emp.click('button:has-text("Balance")');
  check("Balance shows what is left", await waitForText(emp, /left of/, 30_000));
  await shot(emp, "leave-balance");

  /* ---------- the admin decides the order (A104) ---------- */
  const admin = await signedIn(browser, lab.people.admin.email, lab.pw);
  const dropLead = await call(admin, "/api/admin/company", { approvalChain: ["MANAGER", "HR"] }, "PATCH");
  check("the admin can change who approves", dropLead.status === 200, `status=${dropLead.status} ${JSON.stringify(dropLead.json?.error ?? "")}`);

  const shorter = await apply(emp, "CL", monday(5), monday(5));
  const steps = (shorter.json?.data?.approvals ?? []).map((x) => x.step);
  check("a new request follows the new order", JSON.stringify(steps) === JSON.stringify(["MANAGER", "HR"]), JSON.stringify(steps));
  check("and the lead can no longer decide it",
    (await call(lead, `/api/leave/${shorter.json.data.id}/decision`, { decision: "APPROVED" })).status === 403);
  check("while the manager can", (await call(mgr, `/api/leave/${shorter.json.data.id}/decision`, { decision: "APPROVED" })).json?.data?.currentStep === "HR");

  // HR cannot be removed: it is the step anybody in HR can settle, and without
  // it a request can be left pending with nobody able to decide it.
  check("HR cannot be dropped from the chain",
    (await call(admin, "/api/admin/company", { approvalChain: ["TEAM_LEAD", "MANAGER"] }, "PATCH")).status === 422);
  check("nor moved off the end",
    (await call(admin, "/api/admin/company", { approvalChain: ["HR", "MANAGER"] }, "PATCH")).status === 422);
  check("and a step cannot be listed twice",
    (await call(admin, "/api/admin/company", { approvalChain: ["MANAGER", "MANAGER", "HR"] }, "PATCH")).status === 422);

  // Put it back for the suites that follow.
  await call(admin, "/api/admin/company", { approvalChain: ["TEAM_LEAD", "MANAGER", "HR"] }, "PATCH");
}

/**
 * A throwaway company the suites can be rough with, and its removal afterwards.
 *
 * Every run builds a fresh one: an admin, HR, a manager, a team lead, and an
 * employee sitting in a team under both of them. That shape is what the approval
 * chain needs - leave and swipes both walk lead -> manager -> HR - so the suites
 * can test the chain without inventing people of their own.
 *
 * The name carries a timestamp so a crashed run never blocks the next one, and
 * teardown runs from a `finally` so the database does not fill up with labs.
 */
import fs from "node:fs";
import path from "node:path";
import { BASE, WORK, login, call } from "./harness.mjs";

export const PW = "Demo@1234x";
const STATE = path.join(WORK, "lab.json");

const PEOPLE = {
  admin: { name: "Anita Rao", role: "COMPANY_ADMIN" },
  hr: { name: "Fatima Sheikh", role: "HR" },
  mgr: { name: "Arjun Menon", role: "MANAGER" },
  lead: { name: "Vikram Shah", role: "TEAM_LEAD" },
  emp: { name: "Priya Nair", role: "EMPLOYEE" },
};

function superAdminCredentials() {
  const { SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD } = process.env;
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD) {
    throw new Error("SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD must be in .env - the suites create a company to work in.");
  }
  return [SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD];
}

const fail = (what, r) => {
  throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.json?.error ?? r.json ?? "")}`);
};

export async function setUpLab(browser) {
  const stamp = Date.now().toString(36);
  const name = `E2E Lab ${stamp}`;
  const domain = `${stamp}.e2e.local`;
  const people = Object.fromEntries(
    Object.entries(PEOPLE).map(([k, p]) => [k, { ...p, email: `${k}@${domain}` }]),
  );

  const [saEmail, saPassword] = superAdminCredentials();
  const sa = await login(browser, saEmail, saPassword);
  const made = await call(sa, "/api/super-admin/companies", {
    name,
    adminName: people.admin.name,
    adminEmail: people.admin.email,
    adminPassword: PW,
  });
  if (made.status !== 201) fail("creating the company", made);
  const companyId = made.json.data.id;
  await sa.context().close();

  const admin = await login(browser, people.admin.email, PW);
  const ids = {};
  for (const key of ["hr", "mgr", "lead", "emp"]) {
    const r = await call(admin, "/api/employees", { name: people[key].name, email: people[key].email, password: PW, role: people[key].role });
    if (r.status !== 201) fail(`creating ${key}`, r);
    ids[key] = r.json.data.id;
  }
  ids.admin = made.json.data.adminId ?? null;

  const team = await call(admin, "/api/teams", { name: "Field Team", leadId: ids.lead, managerId: ids.mgr });
  if (team.status !== 201) fail("creating the team", team);
  const teamId = team.json.data.id;

  // The employee and the lead both sit under the manager, which is what makes
  // the chain three steps long for the employee.
  for (const key of ["emp", "lead"]) {
    const r = await call(admin, `/api/employees/${ids[key]}`, { teamId, managerId: ids.mgr }, "PATCH");
    if (r.status !== 200) fail(`placing ${key} in the team`, r);
  }
  await admin.context().close();

  const lab = { companyId, name, teamId, ids, people, pw: PW, base: BASE };
  fs.writeFileSync(STATE, JSON.stringify(lab, null, 2));
  return lab;
}

export async function tearDownLab(browser, lab) {
  if (!lab?.companyId) return { skipped: true };
  const [saEmail, saPassword] = superAdminCredentials();
  const sa = await login(browser, saEmail, saPassword);
  const del = await call(sa, `/api/super-admin/companies/${lab.companyId}`, { confirmName: lab.name }, "DELETE");
  await sa.context().close();
  try { fs.unlinkSync(STATE); } catch {}
  return { status: del.status, ok: del.status === 200 };
}

/** Reads the lab a previous run left behind, for running one suite on its own. */
export function readLab() {
  if (!fs.existsSync(STATE)) {
    throw new Error(`No lab on disk at ${STATE}. Run \`npm run test:e2e\`, which makes one.`);
  }
  return JSON.parse(fs.readFileSync(STATE, "utf8"));
}

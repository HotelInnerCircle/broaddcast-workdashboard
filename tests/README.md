# Tests

Two kinds, run separately, because they cost very different amounts.

| | what it covers | needs | how long |
|---|---|---|---|
| `npm test` | the maths and the rules, in isolation | nothing | ~7s |
| `npm run test:e2e` | a real browser against a real server and database | `npm run dev`, and `.env` | ~3 min |

## Unit tests - `npm test`

`tests/unit/*.test.ts`, run by Vitest. No network, no database, no server.

These cover the three places where being wrong is quiet rather than loud:

- **`geo.test.ts`** - the distance between two points. A geofence that is wrong
  by a factor of ten still returns a number, and nobody notices until somebody
  is marked absent from their own office.
- **`company-clock.test.ts`** - working days, holidays, and the day boundary.
  Includes the overnight shift, where 22:00 to 07:00 is a negative number to
  anyone who subtracts the two directly.
- **`permissions.test.ts`** - the matrix, and the boundaries other code leans on.
  Several services filter with `{ ...employeeScopeFilter(ctx), _id: asked }`,
  and for an `EMPLOYEE` that scope is `{ _id: me }` - which the spread then
  overwrites. Those services are safe only because an employee cannot reach
  them. Widen `EMPLOYEE`'s grants and a test fails and explains why, rather than
  a data leak appearing silently.

## End-to-end - `npm run test:e2e`

`tests/e2e/suites/*.mjs`, driven through Playwright with the Chrome already on
the machine. Start the server first:

```bash
npm run dev            # in one terminal
npm run test:e2e       # in another
```

**Start the dev server fresh before a full run.** `next dev` leaks memory across
hot reloads and eventually dies with `JavaScript heap out of memory` - after
about an hour of editing, even with an 8 GB heap. When it goes, every suite after
it fails with `ERR_CONNECTION_REFUSED`, which reads like ten broken features
rather than one dead server. A server that has been sitting idle is fine; one
that has recompiled fifty times is not.

Run some of them:

```bash
npm run test:e2e -- leave ledger
```

### What a run does

1. Creates a throwaway company through the Super Admin API, with an admin, HR, a
   manager, a team lead, and an employee in a team under both. That shape is
   what the approval chain needs.
2. Runs each suite against it.
3. **Deletes the company**, from a `finally`, so a failure halfway through does
   not leave one behind. `E2E_KEEP_LAB=1` keeps it, for when you want to look.

Screenshots and the lab details land in `.e2e/` (git-ignored).

**Sign-in is rate limited to ten attempts a minute per IP**, and the whole run
shares one IP. That is the app behaving correctly, so the harness signs each
person in once and reuses the page for every suite (`signedIn` in `harness.mjs`).
A suite that calls `login` directly for each of its people will trip the limit
somewhere around the third suite, and the failure reads like a broken password
rather than a limit doing its job.

### Settings

| variable | default |
|---|---|
| `E2E_BASE_URL` | `http://localhost:3000` |
| `E2E_CHROME` | the usual Chrome locations for the platform |
| `E2E_HEADED=1` | watch it happen |
| `E2E_KEEP_LAB=1` | do not delete the throwaway company |
| `E2E_WORK_DIR` | `.e2e` |

`SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` come from `.env` - the run needs
them to create the company, and fails early and clearly if they are missing.

### The suites

| suite | what it holds down |
|---|---|
| `scheduling` | shifts (including overnight), holidays, and the phone's profile page |
| `swipes` | the geofence decision, and lead -> manager -> HR with no queue-jumping |
| `timer-grouping` | one line per job with the total, sessions still stored separately |
| `leave` | six types, accrual, the chain, and what History shows |
| `ledger` | what each day counted as - **and that an employee cannot read another's** |
| `profile` | personal details, the photo, and who may change what |
| `employee-codes` | everybody has one, no two the same, the scheme is configurable |

### Adding one

A suite is a module with a `name`, a `description`, and a default function:

```js
import { call, login } from "../harness.mjs";

export const name = "payroll";
export const description = "what the payslip adds up to";

export default async function run({ browser, lab, check }) {
  const hr = await login(browser, lab.people.hr.email, lab.pw);
  const res = await call(hr, "/api/payroll/run", { month: "2026-09" });
  check("HR can run payroll", res.status === 200, `status=${res.status}`);
}
```

Then add it to `ALL` in `run.mjs`. Write the check name as the sentence you would
say out loud - the failure output is read by whoever broke it, months later.

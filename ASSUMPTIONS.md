# ASSUMPTIONS

Every place where the specification (WorkPulse Build Spec v2.0) was silent or could not be followed literally, with what was assumed, why, and where it applies. Numbered so they can be referenced in review.

## Phase 1

### A1. "Database sessions" with Auth.js v5 + Credentials
- **What:** Auth.js v5 throws `UnsupportedStrategy` when `session.strategy = "database"` is combined with a Credentials-only provider set. Sessions are therefore implemented as true database sessions by replacing Auth.js's `jwt.encode` / `jwt.decode` hooks: the cookie carries only an opaque 256-bit random token, the session row lives in the `sessions` collection (`models/Session.ts`), and every request resolves the token against MongoDB (`lib/auth/session-service.ts`). No JWT is ever issued or verified. Deleting rows invalidates sessions immediately (role change, deactivation, password reset, company suspension).
- **Why:** Satisfies the intent of spec 3.2 (server-side invalidation) without fighting the library or adding a dummy second provider.
- **Where:** `auth.ts`, `lib/auth/session-service.ts`, `models/Session.ts`.

### A2. Middleware is a cookie-presence gate; layouts do the real check
- **What:** `middleware.ts` (Edge runtime, no DB access) only checks that the session cookie exists and redirects to `/login` otherwise; it does not know the role. `app/(dashboard)/layout.tsx` validates the session against the DB and each role segment layout (`admin/`, `manager/`, `team/`, `employee/`, `super-admin/`) enforces the role with a real HTTP redirect. Every API route validates independently.
- **Why:** Spec 6.5 asks for "middleware plus server-side checks"; Mongoose cannot run in the Edge runtime.
- **Where:** `middleware.ts`, `app/(dashboard)/**/layout.tsx`, `lib/auth/context.ts`.

### A3. `bcryptjs` instead of native `bcrypt`
- **What:** Passwords are hashed with the bcrypt algorithm at cost 12 using the pure-JS `bcryptjs` package.
- **Why:** Identical algorithm and output format; avoids native compilation problems on Windows and in Alpine Docker images.
- **Where:** `lib/auth/password.ts`.

### A4. Extra models not listed in spec section 8
- **What:** `Session` (A1), `PasswordResetToken` (single-use, 1-hour tokens for spec 6.4) and the `AuditLog` fields `actorRole`, `actorName`, `summary`, `crossTenant`, `ip`.
- **Why:** Needed to implement the described behaviour; they are additive.
- **Where:** `models/Session.ts`, `models/PasswordResetToken.ts`, `models/AuditLog.ts`.

### A5. A `User` row is created at invite time with `status: "invited"`
- **What:** Inviting someone creates the user immediately (name defaults to the email local part) plus an `Invite` row holding the token hash. Accepting sets the name/password and flips status to `active`. Revoking an invite deactivates and archives that placeholder user.
- **Why:** The spec's `User.status` enum includes `invited`; this keeps headcount, plan-limit checks and the employees list consistent and makes the invite email address unique from the start.
- **Where:** `services/inviteService.ts`.

### A6. Manager scope and `Team.managerId`
- **What:** The spec's Team model has only `leadId`; an optional `managerId` was added so "a manager can oversee multiple teams" has a concrete representation. A manager's scope = users whose `managerId` is the manager, plus members of teams whose `managerId` is the manager. Managers may invite only `TEAM_LEAD`/`EMPLOYEE` and only into teams they manage; only a Company Admin can deactivate people or reassign managers.
- **Why:** Spec section 5 says "invite/edit within scope" without defining scope.
- **Where:** `models/Team.ts`, `services/scope.ts`, `services/inviteService.ts`, `services/employeeService.ts`.

### A7. Company Admin may invite other Company Admins
- **What:** The invite role picker for a Company Admin offers all four company roles, including `COMPANY_ADMIN`.
- **Why:** Spec 5 gives admins "Manage employees & managers"; a second admin is a normal need. Super Admins can never be created via invite or registration (spec 6.3).
- **Where:** `lib/validation/employees.ts`, `components/employees/invite-dialog.tsx`.

### A8. Rate limiting is in-memory per process
- **What:** Sliding-window limiter (10 requests / minute / IP) on `/api/auth/*`, registration, forgot/reset password and invite acceptance.
- **Why:** Spec 4.8 gives the number but not the store; the deployment target is a single Node process on a VPS. Swap for Redis if multiple app instances are ever run.
- **Where:** `lib/rate-limit.ts`.

### A9. Development email outbox
- **What:** With `SMTP_HOST` empty, emails are logged to the console (per spec 3.5) **and** appended to `.dev/outbox.jsonl` when `NODE_ENV !== production`.
- **Why:** Lets `npm run verify:phase1` read invite and reset tokens without a mail server. Never active in production.
- **Where:** `lib/email/index.ts`.

### A10. Setup wizard placement
- **What:** After registration the admin is signed in and sent to `/admin/setup` (timezone, working hours, working days, late threshold, logo; "Skip for now" available). Root `/` always redirects to the role home, and the admin dashboard shows a "Finish setting up your workspace" banner until the wizard is completed or skipped.
- **Why:** Reconciles spec 6.1 (registration -> wizard) with the Phase 1 acceptance criterion (admin lands on `/admin/dashboard`).
- **Where:** `components/auth/register-form.tsx`, `app/(dashboard)/admin/setup/page.tsx`, `app/page.tsx`, `components/dashboard/setup-banner.tsx`.

### A11. Local storage driver serves files through a signed route
- **What:** `STORAGE_DRIVER=local` writes under `LOCAL_STORAGE_DIR` (outside the web root) and serves via `/api/files/<key>?exp=&sig=` using an HMAC of `AUTH_SECRET`. The company logo URL is a one-year signed URL.
- **Why:** Spec 3.4 requires signed URLs even for the development driver.
- **Where:** `lib/storage/local.ts`, `app/api/files/[...key]/route.ts`.

### A12. Tenant guard opt-out for `populate()` and cross-tenant paths
- **What:** A Mongoose plugin throws if any query on a tenant model lacks `companyId`. The explicit opt-out (`unscopedOptions` / `pop()` helper) is used only in: auth internals (login by email), invite-token lookup, super-admin services, the seed script, and `populate()` calls whose ids come from an already tenant-scoped parent query.
- **Why:** Spec 4.2 ("forgetting the tenant filter must be impossible by construction"); `User` cannot carry the strict plugin because `SUPER_ADMIN` rows have `companyId: null`, so all company-facing user access goes through `scoped(User, ctx)` instead.
- **Where:** `lib/db/tenant-plugin.ts`, `lib/db/scoped.ts`.

### A13. Presence before Phase 5
- **What:** Status tables show "Online" when `lastActiveAt` is within 5 minutes (updated on authenticated requests, throttled to once per 5 minutes), otherwise "Offline". Working/Break states arrive with the timer (Phase 3) and sockets (Phase 5).
- **Why:** Spec 7.6 says status is computed on page load until the realtime layer ships.
- **Where:** `services/dashboardService.ts`, `lib/auth/session-service.ts`.

### A14. Production server bundle
- **What:** `npm run build` runs `next build` and bundles `server.ts` with esbuild into `dist/server.js` (node_modules stay external). Dev uses `tsx watch server.ts`.
- **Why:** A plain `tsc` emit would leave `@/` path aliases unresolved at runtime.
- **Where:** `package.json`, `Dockerfile`.

### A15. Plans seeded with concrete limits
- **What:** Starter (10 users / 10 projects / 5 clients / 1 GB, INR 0, default for new registrations), Business (50 / 100 / 50 / 10 GB, INR 2,999), Enterprise (1000 / 5000 / 1000 / 100 GB, INR 9,999). `checkLimit(companyId, "users")` runs on every invite; project/client/storage limits are wired into the same function and enforced when those collections arrive.
- **Why:** Spec section 15 defines the mechanism but not the numbers. All values are editable in the `plans` collection by the Super Admin.
- **Where:** `scripts/seed.ts`, `lib/limits.ts`.

## Phase 2

### A16. Assigning a task adds the assignee to the project
- **What:** When a task is created or reassigned, the assignee is added to `Project.memberIds` if missing.
- **Why:** Employees see projects they are members of (spec 5: "view assigned"); without this an employee could hold a task in a project they cannot open.
- **Where:** `services/taskService.ts`.

### A17. What "update own" means for employees
- **What:** An employee may change only the `status` of tasks assigned to them, and add/remove their own attachments. Title, description, priority, due date, estimate, assignee and archiving require MANAGER/COMPANY_ADMIN (or TEAM_LEAD within the team). Any other field in an employee PATCH returns 403.
- **Why:** Spec 5 grants employees "update own" without listing fields; status is what the Kanban and daily flow need, and letting assignees rewrite scope or reassign themselves would bypass managers.
- **Where:** `services/taskService.ts` (`updateTask`).

### A18. Team lead scope for projects, tasks and clients
- **What:** Team lead sees projects managed by them or having a team member; tasks assigned to team members or created by the lead; all clients (read-only). Team leads may assign tasks only to their own team members (or themselves).
- **Why:** Spec 5 says "view team's" / "own team" without a formal definition.
- **Where:** `services/scope.ts`, `services/taskService.ts` (`assertAssignable`).

### A19. Kanban shows five columns; other statuses live in the list view
- **What:** The board has Backlog / To Do / In Progress / Review / Completed as the spec lists. Blocked, On Hold and Cancelled tasks are not on the board (a note says how many are hidden) and can be reached from the list view, the task detail, or the per-card status select.
- **Why:** Spec 12.9 names exactly five columns while the Task status enum has eight values.
- **Where:** `components/tasks/kanban-board.tsx`, `types/index.ts` (`KANBAN_COLUMNS`).

### A20. Date-only inputs are interpreted in the company timezone
- **What:** `dueDate`, `startDate` and `deadline` accept `YYYY-MM-DD` and are stored as midnight of that day in the company timezone (UTC in the database). Overdue (spec 7.7) compares the company-timezone day key. Forms are pre-filled from `dueKey` / `startKey` / `deadlineKey` rather than slicing the UTC ISO string.
- **Why:** Spec 14 (store UTC, convert at the edges) plus spec 7.7 (end of day in company timezone). Naive `new Date("YYYY-MM-DD")` would shift a day for negative UTC offsets.
- **Where:** `lib/utils/dates.ts` (`parseDateInput`), `lib/validation/common.ts` (`dateInput`).

### A21. Task attachments ship in Phase 2, comments in Phase 5
- **What:** Task detail already supports attachments (images, PDF, docx/xlsx/pptx, 10 MB, validated server-side, served through signed URLs). The comments thread with mentions is a Phase 5 item per spec 17.
- **Why:** Spec 12.9 lists attachments under task detail (Phase 2) while spec 17 places comments with mentions in Phase 5.
- **Where:** `app/api/tasks/[id]/attachments/*`, `components/tasks/task-detail.tsx`.

### A22. Project progress uses the same "done" rule as overdue
- **What:** progress % = Completed / (total - Cancelled) x 100 (spec 12.11). "Pending" counts everything not Completed/Cancelled, including Blocked/On Hold. `completedAt` is stamped whenever a task enters Completed and cleared when it leaves.
- **Why:** Needed for reports (Phase 4) to reconcile exactly with task history.
- **Where:** `services/projectService.ts` (`projectProgressMap`), `services/taskService.ts`.

## Phase 3

### A23. Work time vs. session time
- **What:** Two distinct measures are kept. *Tracked hours* (timesheets, task `actualMinutes`, "Today's hours" in the status table) come from timer entries. *Attendance* records `workSeconds = (clockOut - clockIn) - breaks of the day`; Half Day is decided on this attendance figure (spec 7.5: "total worked time < 50% of scheduled hours"). The daily summary (spec 7.4) shows Work Time (timers), Break Time (breaks) and Total Session Time (clock-in to clock-out).
- **Why:** The spec defines both timers and attendance but not which one "worked time" refers to; attendance-based Half Day is robust to people who forget timers, while tracked hours stay exact for reports.
- **Where:** `services/attendanceService.ts` (`closeRecord`), `services/timerService.ts` (`daySummary`).

### A24. Auto-close also stops timers and breaks left open overnight
- **What:** The forgotten clock-out job (end-of-day + 2h, spec 7.5) closes any RUNNING/PAUSED timer and open break of that user at the same cutoff instant and flags them `autoClosed`. It runs every 5 minutes inside the custom server (`lib/jobs`) and is idempotent.
- **Why:** Otherwise a forgotten timer would accumulate overnight and corrupt timesheets and reports.
- **Where:** `services/attendanceService.ts` (`autoCloseForgotten`), `lib/jobs/index.ts`, `server.ts`.

### A25. Timers do not require a clock-in; clock-out ends everything
- **What:** Starting a timer does not clock the employee in (clock-in stays an explicit button per spec 7.5); the timer page nudges when not clocked in. Clocking out stops a running timer and ends an open break, since the working session is over. Starting a timer or resuming one ends an open break.
- **Why:** Spec keeps Clock In/Out explicit; the other rules avoid impossible states (working while clocked out / on break).
- **Where:** `services/attendanceService.ts` (`clockOut`), `services/timerService.ts` (`startTimer`, `resumeTimer`).

### A26. Absent rows are computed, not stored
- **What:** The attendance list fills every past working day (company `workingDays`) that has no record for an active user who had joined by then with a virtual `Absent` row (`virtual: true`, not persisted). Today is never marked absent. Leave records are stored (set manually by admin/manager). Status precedence at clock-out: Half Day > Late > Present.
- **Why:** Spec 7.5 defines Absent as "no clock-in on a working day"; computing it keeps the collection append-free and always consistent with working-day settings. Reports (Phase 4) reuse the same function so numbers reconcile.
- **Where:** `services/attendanceService.ts` (`listAttendance`).

### A27. Starting a timer moves a To Do / Backlog task to In Progress
- **What:** The first timer on a task in `To Do` or `Backlog` sets the task status to `In Progress`; Completed/Cancelled tasks cannot be timed (reopen first).
- **Why:** Keeps the Kanban truthful without extra clicks; a timed task is by definition in progress.
- **Where:** `services/timerService.ts` (`startTimer`).

### A28. Timer entry day key and cross-midnight entries
- **What:** `TimeEntry.date` is the company-timezone day of the first segment start. An entry running past midnight stays on its start day (rare; the auto-close job ends it at end-of-day + 2h anyway).
- **Why:** Spec section 8 asks for a "day key in company timezone" without specifying split behaviour; a single key keeps timesheet totals simple and reconcilable.
- **Where:** `models/TimeEntry.ts`, `services/timerService.ts`.

## Phase 4

### A29. Every hour figure in every report derives from the timesheet query
- **What:** `reportService` obtains hours exclusively through `listTimeEntries` with the same filters the Timesheets page uses (date range in company-timezone day keys, employee, team, client, project). Running/paused entries count their live elapsed time in both places. Report totals therefore reconcile exactly with the timesheet by construction; `verify:phase4` asserts equality to the second.
- **Why:** Spec 12.18 ("report numbers must reconcile exactly with the timesheet data they summarize").
- **Where:** `services/reportService.ts` (`timeBase`), `services/timesheetService.ts`.

### A30. Definitions behind the transparent productivity metrics
- **What:** Per employee and range: *tracked hours* (timesheet); *tasks completed* = `completedAt` inside the range; *tasks overdue* = currently overdue open tasks assigned to them; *estimated vs actual* = sums over the tasks they completed in the range; *projects / clients worked* = distinct projects/clients of their entries in the range; *daily reports* = submitted / completed working days in the range; *attendance* = counts of Present / Late / Half Day / Absent / Leave from the attendance list (virtual Absent rows included). No weighting, no score.
- **Why:** Spec 12.18 asks for transparent numbers only and forbids an opaque "employee score"; each definition is stated on the page.
- **Where:** `services/reportService.ts` (`employeeReport`).

### A31. Task report population
- **What:** The task report covers tasks that were open at any point in the range (created before the range end and not completed before the range start) plus tasks created in the range; "completed in range" and "created in range" are counted separately. Tracked time is shown both for the range and all-time (`actualMinutes`).
- **Why:** The spec lists the report without defining which tasks belong to a date range.
- **Where:** `services/reportService.ts` (`taskReport`).

### A32. Archived clients and projects remain in reports
- **What:** Client and project reports include archived records when they have hours in the range (or are selected explicitly), flagged "Archived"; pickers still hide them.
- **Why:** Spec 7.8 ("archived records ... remain in historical reports"). Without this the client report dropped the archived client's hours and no longer reconciled with the timesheet.
- **Where:** `services/reportService.ts` (`clientReport`, `projectReport`).

### A33. Export format details
- **What:** CSV is UTF-8 with BOM (so Excel opens it correctly) and CRLF line endings; Excel is built with `exceljs` (title, subtitle, frozen header row, totals row); PDF is built with `pdfkit` (A4, landscape when wider than six columns, repeated header per page, zebra rows, generated-on footer). Each report exports its main table (the same rows shown on screen); charts are not embedded. Times in exports use the company timezone. Every export is audited (`report.exported`).
- **Why:** Spec 12.18 requires all three formats to "open correctly"; table exports are what analysts re-process.
- **Where:** `lib/export/index.ts`, `lib/api/report-route.ts`.

### A34. Daily report routes
- **What:** Employees submit at `/daily-report` (also reachable from the dashboard quick action and the TIME sidebar group); one report per person per company-timezone day, re-submitting updates it; future dates are refused. The manager view lives at `/reports/daily` as specified; employees who open that URL get their own form.
- **Why:** Spec 12.17 defines the manager view URL but not the employee form URL.
- **Where:** `app/(dashboard)/daily-report`, `app/(dashboard)/reports/daily`, `services/dailyReportService.ts`.

### A35. Chart palette
- **What:** Charts use a fixed, CVD-validated categorical order (blue, orange, aqua, yellow, magenta, green, violet, red; separate steps for dark mode) declared as `--chart-1..8` tokens, single-hue blue for magnitude, and never a dual axis. Status colours stay reserved for status.
- **Why:** Spec 13 (color used mainly for status; keep charts simple) plus accessibility.
- **Where:** `app/globals.css`, `components/reports/charts.tsx`.

## Phase 5

### A36. Presence store is in-process; a clean disconnect is Offline immediately
- **What:** Heartbeats (every 30s from the browser) and open-socket counts live in a per-process map. A user is Online while a heartbeat is younger than 90s; a sweeper (every 15s) flips stale users to Offline and broadcasts `presence:update`. When the last socket closes cleanly (tab closed), the user is marked Offline immediately rather than waiting 90s. Working = Online + RUNNING timer; Break = open break.
- **Why:** Spec 7.6 defines the 90s rule for missing heartbeats; an explicit close is a stronger signal. Single-node per spec 3.1 - move the map to Redis when running several instances.
- **Where:** `lib/realtime/presence.ts`, `lib/realtime/socketio.ts`, `services/dashboardService.ts`.

### A37. Who can read which conversation
- **What:** DMs: the two participants only. Team channels: the team's members, its lead and manager, plus Company Admins. Project channels: project members and manager, plus Company Admins. Channels are created lazily the first time an eligible user opens chat. A socket may join a conversation room only after the same server-side check (`chat:join` acks false otherwise).
- **Why:** Spec 12.15 lists DM/team/project channels without membership rules; this mirrors the people/project scopes used elsewhere.
- **Where:** `services/chatService.ts` (`channelScope`, `getAccessibleConversation`, `conversationMembers`).

### A38. Which chat events become notifications
- **What:** A DM creates a `MESSAGE` notification for the recipient; channel messages notify only the people @mentioned (`MENTION`). Every member still receives a live `chat:activity` event (toast + unread badge) so nothing is missed without flooding the bell.
- **Why:** Spec 12.16 lists MESSAGE and MENTION types; notifying every channel member for every message would be noise (spec 20.5).
- **Where:** `services/chatService.ts` (`sendMessage`).

### A39. Mentions are explicit ids, rendered as @Name
- **What:** The composer inserts `@Full Name` into the text and sends the selected user ids as `mentions`; the server keeps only ids that are members/candidates and not the author. The same rule applies to task comments (candidates = project members, manager, assignee, creator, admins and managers).
- **Why:** Name matching alone is ambiguous; ids are unambiguous and validated server-side.
- **Where:** `components/chat/thread.tsx`, `components/tasks/task-comments.tsx`, `services/commentService.ts`.

### A40. Notification triggers and reminders
- **What:** TASK_ASSIGNED (assignment), TASK_COMPLETED (to creator and project manager), TASK_COMMENT (assignee + creator, unless mentioned), MENTION, MESSAGE (DMs), PROJECT_UPDATE (status/deadline change, to members + manager), ANNOUNCEMENT (all active users), TIMER (auto-closed timer). DEADLINE (due today/tomorrow) and TASK_OVERDUE are produced by a job every 30 minutes with a per-user/task/day dedupe key, so each task reminds at most once per day. Nobody is notified about their own action.
- **Why:** Spec 12.16 lists the types but not when they fire.
- **Where:** `services/*Service.ts`, `lib/jobs/reminders.ts`, `models/Notification.ts` (`dedupeKey` unique partial index).

### A41. Activity feed scope and payload
- **What:** `audit()` also emits `activity:new` (ids + summary) to the company room; the feed API returns audit entries filtered to the caller's people scope (admins/managers: whole company; team leads: their team's actors). Super-admin cross-tenant entries are excluded from company feeds.
- **Why:** Spec 10 asks for minimal payloads with client refetch; spec 12.1 wants the feed on the manager dashboard.
- **Where:** `lib/audit.ts`, `services/searchService.ts` (`activityFeed`), `components/dashboard/live-activity.tsx`.

### A42. Comment deletion and message editing rules
- **What:** Users may edit/delete only their own chat messages (deleted messages show "Message deleted"; attachments are removed from storage). Task comments can be deleted by their author, or by a Company Admin / Manager; there is no comment editing in the MVP.
- **Why:** Spec 12.15 says "edit/delete own messages"; comment moderation by managers keeps threads clean.
- **Where:** `services/chatService.ts`, `services/commentService.ts`.

### A43. Global search
- **What:** Minimum two characters; up to 6-10 hits per group; groups are Employees, Clients, Projects, Tasks, Messages, each filtered by the caller's scope. A client hit also surfaces that client's projects and tasks (the "Amaya" example in spec 12.22). Message search is a case-insensitive substring match over conversations the caller can read.
- **Why:** Spec 12.22 defines grouping and the example, not limits or matching.
- **Where:** `services/searchService.ts`, `components/layout/command-palette.tsx`.

## Phase 6

### A44. Razorpay integration shape: one-time orders per billing period, webhook is the source of truth
- **What:** Upgrading creates a Razorpay Order (amount = plan price x 100 paise; yearly = 10 x monthly) whose notes carry `companyId`, `planId` and `cycle`. The browser opens Razorpay Checkout; the success callback is verified by the checkout HMAC (`order_id|payment_id`) and applied immediately, and the `payment.captured` / `order.paid` webhook (HMAC over the raw body with `RAZORPAY_WEBHOOK_SECRET`) applies the same change idempotently by `paymentId`. A paid period extends the current period when the same plan is still active, otherwise starts today. The free plan switches without payment.
- **Why:** Spec 3.6 makes Razorpay optional and behind a billing service; orders + webhooks are the simplest reliable path and avoid Razorpay's subscription/mandate flow for the MVP.
- **Where:** `lib/billing/index.ts`, `services/billingService.ts`, `app/api/billing/*`.

### A45. Without gateway keys the plan system still works
- **What:** `POST /api/billing/checkout` returns `503 BILLING_DISABLED` (with the support email) when `RAZORPAY_KEY_ID/SECRET` are missing; the Subscription tab explains that plans are assigned by the platform administrator. Super Admin plan changes write a `manual` payment record so the billing history stays complete. The webhook works whenever `RAZORPAY_WEBHOOK_SECRET` is set, which is how `verify:phase6` exercises a test-mode payment with a locally signed payload.
- **Why:** Spec 3.6 / section 15 require the limits to work with no gateway at all.
- **Where:** `services/billingService.ts`, `components/settings/subscription-view.tsx`.

### A46. Storage limit accounting
- **What:** Storage usage = bytes of task attachments + chat attachments (company logos excluded); `checkLimit("storage", { addBytes })` runs before every upload. A limit of -1 means unlimited for any key.
- **Why:** Spec section 15 lists `storage` as a limit key without defining what counts.
- **Where:** `lib/limits.ts`, attachment routes.

### A47. Audit viewers
- **What:** Company Admins get `/admin/audit` (filters: action, entity, actor, date range; before/after JSON expandable). The Super Admin gets `/super-admin/audit` across all companies with company and cross-tenant filters; viewing it, opening a company detail, or listing companies is itself audited as cross-tenant (`superadmin.*` actions). Super Admin cross-tenant access stays read-only except the three explicit actions (suspend, reactivate, change plan) and plan editing.
- **Why:** Spec 4.6 and Phase 6 ("audit log viewer", "cross-tenant reads appear in the audit log").
- **Where:** `components/admin/audit-viewer.tsx`, `services/superAdminService.ts`.

### A48. Verification suites and the dev email outbox
- **What:** `verify:phase1` reads invite/reset tokens from `.dev/outbox.jsonl`, which exists only in development (A9); against a production build those four checks report "no email found" by design. All six suites pass against both the dev server and the production build; when run back-to-back they must be spaced ~1 minute apart because the auth rate limiter (10 logins/min/IP, spec 4.8) blocks the logins otherwise.
- **Where:** `scripts/verify-phase*.ts`.

### A49. Visual design direction (post-Phase 6, user-selected)
- **What:** The UI follows the direction the owner picked from the design canvas on 21 Sep 2026: the "Bento" layout (dark icon rail with tiny labels, KPI colour tiles, borderless rounded cards floating on a padded canvas, pill buttons/toggles, squircle avatars) in the "Linen" palette and type (warm paper `#f4f0e8`, cocoa accent `#8a5a3c`, Instrument Serif for display text + DM Sans for body). Dark mode is a warm-charcoal variant of the same tokens; the rail stays dark in both themes. The sidebar defaults to the icon rail and remembers the user's expand/collapse choice (`wp.sidebar`). Single-series charts use the accent (`--chart-single`); multi-series charts keep the CVD-validated categorical order (`--chart-1..8`) unchanged.
- **Why:** The spec fixes the stack but leaves the visual language open ("aesthetic, elegant, premium"); the owner chose a hybrid of two proposed directions.
- **Where:** `app/globals.css` (all tokens), `app/layout.tsx` (fonts), `config/brand.ts`, `components/layout/*`, `components/ui/*`, `components/dashboard/stats-card.tsx`, `app/(auth)/layout.tsx`.

### A50. Full navigation after sign-in
- **What:** Login, register and accept-invite forms navigate with `window.location.assign()` after a successful `signIn()` instead of `router.push()` + `router.refresh()`.
- **Why:** In production Next.js prefetches the login page's `<Link href="/">`; that prefetch runs before the session cookie exists, so the router cache holds a `/ -> /login` redirect and a client-side push after sign-in landed back on `/login` (not reproducible in dev, where prefetching is off).
- **Where:** `components/auth/{login-form,register-form,accept-invite-form}.tsx`.

### A51. Failed MongoDB connection attempts are not cached
- **What:** `connectDB()` clears its cached promise when the connection attempt rejects, so the next request retries instead of every request failing forever.
- **Why:** Observed on 21 Sep 2026: a transient `querySrv ECONNREFUSED` at boot left the production server returning 500 on every request until restart.
- **Where:** `lib/db/connect.ts`.

### A52. Optional `DNS_SERVERS` override for `mongodb+srv`
- **What:** If `DNS_SERVERS` (comma-separated) is set, `connectDB()` calls `dns.setServers()` before the first connection. Unset = Node default.
- **Why:** On the development machine Node's resolver reported only `127.0.0.1` (adapter enumeration failure), so Atlas SRV lookups failed with `querySrv ECONNREFUSED` while the OS resolver worked. Explicit servers fix it without changing the machine.
- **Where:** `lib/db/connect.ts`, `.env.example`.

### A53. Timers run on Client + Project; work notes are mandatory (owner change, 21 Sep 2026)
- **What:** The Timer page offers only Client and Project (the client is implied by the project and copied onto the entry). `POST /api/timer/start` takes `{ projectId, taskId?, force?, previousNotes? }`; `TimeEntry.taskId` is optional and is set only when a timer is started from a task page ("Start timer" on a task), which keeps the task's cached `actualMinutes` and the Tasks report meaningful for those entries. Stopping a timer requires `notes` (3-1000 chars) describing the work completed; confirm-and-switch (`force`) requires `previousNotes` for the entry it closes. Only the system auto-close (end of day + 2h) may leave notes empty, and the timesheet flags those rows. Notes appear on the timer page, in timesheets and in the time report exports.
- **Why:** Owner instruction: "In the Employee / Timer section there should be only Client and Project fields ... Task Notes should be mandatory, as they should describe the work that was completed." This amends spec 7.1 (Client -> Project -> Task).
- **Where:** `models/TimeEntry.ts`, `lib/validation/time.ts`, `services/timerService.ts`, `hooks/useTimer.tsx`, `components/timer/*`, `components/tasks/task-detail.tsx`, `components/timesheets/timesheets-view.tsx`, `services/reportService.ts`, `scripts/seed-phase3.ts`, `scripts/verify-phase3.ts`.

### A54. ImageKit replaces S3-compatible storage (owner change, 21 Sep 2026)
- **What:** ImageKit is the only file storage (the S3 driver, the AWS SDK and - on 22 Sep 2026 at the owner's request - the local-disk driver, `/api/files` route and `uploads/` folder are removed; `STORAGE_DRIVER`/`LOCAL_STORAGE_DIR` no longer exist). The ImageKit driver uploads every object as a *private* file at `/<key>` (deterministic path, `useUniqueFileName=false`) and serves it through ImageKit signed URLs, so the access model is unchanged: nothing is publicly reachable without a signature. Keys keep the `companies/<id>/...` prefix, which becomes an ImageKit folder; the new `deletePrefix()` on the storage interface deletes that folder when a company is deleted. Non-image attachments (PDF, DOCX, XLSX, PPTX) are stored the same way - ImageKit accepts them as raw files. Configure `IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` (verified 22 Sep 2026 against the owner's account: upload, signed fetch 200, unsigned fetch 403, delete, folder delete). Deletes resolve the fileId from an in-process cache of this server's uploads, falling back to a name search with a short retry because ImageKit's search index lags ~1-2 s. Records that pointed at local-disk files (one company logo) were cleared and must be re-uploaded.
- **Why:** Owner instruction: "remove the S3 bucket integration and use ImageKit for image storage and management instead." Amends spec 3.4.
- **Where:** `lib/storage/{imagekit,local,index,types}.ts`, `lib/env.ts`, `.env.example`, `next.config.ts` (`imagekit` is a server-external package).

### A55. Only the Super Admin creates and deletes companies (owner change, 21 Sep 2026)
- **What:** Public self-registration (`/register`, `POST /api/auth/register`) is removed. `POST /api/super-admin/companies` creates the company (default or chosen plan, optional timezone) and invites its first Company Admin by email through the normal invite flow (7-day link, admin sets their own password); the invite link is also returned to the Super Admin for hand-over when SMTP is not configured. `DELETE /api/super-admin/companies/:id` with `{ confirmName }` (must match the company name) permanently removes the company, every tenant collection (users, sessions, invites, teams, clients, projects, tasks, comments, time entries, breaks, attendance, daily reports, conversations, messages, notifications, announcements, subscription, invoices), password-reset tokens of its users and its uploaded files. Audit-log rows are append-only and are kept; `company.created` and `company.deleted` are written as cross-tenant events. No company role can delete its own company.
- **Why:** Owner instruction: "Only the Super Admin can create a company, and only the Super Admin should have the option to delete an entire company." Amends spec 6.1.
- **Where:** `services/superAdminService.ts`, `app/api/super-admin/companies/**`, `components/super-admin/company-dialogs.tsx`, `components/dashboard/companies-table.tsx`, `lib/validation/company.ts`, `middleware.ts`, `scripts/verify-phase1.ts`.

### A56. Accounts can be created directly with a password (owner change, 22 Sep 2026)
- **What:** Besides email invitations, an admin/manager can create a teammate directly (name, email, role, team, manager, password) via `POST /api/employees`; the account is active immediately and the dialog shows the credentials once (with a copy button and a password generator) so the admin can hand them over. Placement rules are identical to invites (Managers only TEAM_LEAD/EMPLOYEE into their own teams; plan user limit; EMAIL_TAKEN), audited as `user.created` with `method: "direct"`. The Super Admin's "New company" form has the same optional admin password: set it and the Company Admin is active at once (no invite email); leave it empty to invite. Passwords are never emailed by the system.
- **Why:** Owner instruction: employees were only being invited; they want to create accounts with role, name, email and password and give them to people.
- **How to apply:** Employees -> Add employee -> "Create with password" (default) or "Send email invitation".
- **Where:** `lib/validation/{employees,company}.ts`, `services/inviteService.ts` (`createEmployee`, shared `validatePlacement`), `services/superAdminService.ts`, `app/api/employees/route.ts`, `components/employees/invite-dialog.tsx`, `components/super-admin/company-dialogs.tsx`, `scripts/verify-phase1.ts`.

### A57. Company-defined job designations (owner change, 22 Sep 2026)
- **What:** `Company.designations` (string list, max 100) is maintained by the Company Admin in Settings -> Company -> "Job designations" (add / remove chips, with suggestions); it is separate from the fixed access roles (Admin / Manager / Team Lead / Employee). `User.designation` is chosen from that list in Add employee (both create and invite modes) and in the employee edit sheet; it shows under the role badge in the Employees table and in the employee header. Removing a designation from the list does not change people who already have it (the edit sheet keeps their current value selectable). `GET /api/company/designations` serves the list to anyone who can view employees.
- **Why:** Owner request: a dropdown of company-specific roles such as "Web Developer" that the admin can add to.
- **Where:** `models/{Company,User}.ts`, `lib/validation/{company,employees}.ts`, `services/{companyService,employeeService,inviteService}.ts`, `app/api/company/designations/route.ts`, `components/settings/designations-editor.tsx`, `components/employees/{invite-dialog,employee-sheet,employees-view}.tsx`, `hooks/usePickers.ts` (`useDesignations`), `scripts/seed.ts`.

### A58. Timer = Client + "what are you working on" (owner change, 22 Sep 2026; supersedes the project field of A53)
- **What:** The Timer page asks for the Client and a mandatory note (3-1000 chars) describing the work; there is no project picker. `POST /api/timer/start` takes `{ clientId, notes, projectId?, taskId?, force?, previousNotes? }`; `TimeEntry.projectId` and `taskId` are optional and are set only when the timer is started from a task page (client/project/task come from the task and the note defaults to "Working on <task>"). Stopping still requires notes (A53) but the stop dialog is pre-filled with the start note, so confirming is one click and refining is optional. The live status table shows the note when there is no task; project/task reports only include entries that carry a project/task.
- **Why:** Owner instruction on the timer screen: "we have client, remove project, just change add notes what they are working".
- **Where:** `models/TimeEntry.ts`, `lib/validation/time.ts`, `services/timerService.ts`, `hooks/useTimer.tsx`, `components/timer/{timer-page,mini-timer,stopwatch-widget}.tsx`, `components/tasks/task-detail.tsx`, `services/dashboardService.ts`, `components/dashboard/status-table.tsx`, `scripts/verify-phase{3,5}.ts`.

### A59. Repository hygiene and security hardening (22 Sep 2026, before the first git push)
- **What:**
  - `.gitignore` / `.dockerignore` exclude every `.env*` except `.env.example`, key/cert files, `.dev/` (email outbox, exports), logs, build output, editor/OS files. No secret is hard-coded in source; demo passwords live only in the seed and `.env.example`.
  - `lib/security/startup-checks.ts` runs before the server listens: AUTH_SECRET must be 32+ chars and not a placeholder, SUPERADMIN_PASSWORD must not be a default/short value, RAZORPAY_WEBHOOK_SECRET (if set) must be strong, APP_URL must be https and MONGODB_URI must not be localhost in production. Violations abort a production start; development and local production runs (APP_URL on localhost) only warn.
  - HTTP headers (next.config.ts): Content-Security-Policy (self + Razorpay checkout + the ImageKit endpoint; inline scripts/styles allowed because Next.js/Tailwind require them), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy, X-DNS-Prefetch-Control off, `poweredByHeader: false`, and HSTS + upgrade-insecure-requests when APP_URL is https. Verified in a browser: zero CSP violations across dashboard, chat (WebSocket), reports, settings, employees, timer, tasks; ImageKit images render.
  - Already in place from earlier phases: bcrypt cost 12, DB-backed sessions revocable server-side, HttpOnly/SameSite=Lax cookies (Secure over https), auth/forgot/reset rate limits (10/min/IP), Zod validation on every input, tenant guard on every query, upload type/size/magic-byte checks, signed-only file URLs, HMAC-verified Razorpay webhooks, append-only audit log.
- **Why:** Owner request before pushing to git: ignore what must be ignored and improve security.
- **Where:** `.gitignore`, `.dockerignore`, `lib/security/startup-checks.ts`, `server.ts`, `next.config.ts`, `.env.example`.

### A60. Seed and verification scripts removed; platform bootstraps itself (owner change, 22 Sep 2026)
- **What:** The `scripts/` folder (demo seed `seed.ts` + `seed-phase2..5.ts`, and the acceptance suites `verify-phase1..6.ts`) and the `npm run seed` / `verify:phase*` commands are deleted at the owner's request. What the seed used to provide structurally now happens at server start in `lib/bootstrap.ts`: default plans are inserted when the `plans` collection is empty, and the Super Admin from `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD` is created when missing (its password is re-synced from `.env` when it changes). Demo companies/people/time entries are no longer generated; the demo data already in the current database is untouched.
- **Why:** Owner instruction: "i want to delete scripts folder". Verification results recorded in this file (Phases 1-6 and A53-A58) were obtained before the removal.
- **Where:** `lib/bootstrap.ts`, `server.ts`, `package.json`, `README.md`.

### A61. Only Managers add clients; a Manager's clients are visible to everyone under them (owner change, 22 Sep 2026)
- **What:** `clients.create` is granted to MANAGER only (Company Admin keeps view/update/archive). A client's owner is its `createdBy`. Visibility: Company Admin - all; Manager - clients they created (plus legacy clients with no creator); Team Lead / Employee - clients created by their manager (their `managerId`, or their team's `managerId`), plus clients of projects they are members of, plus legacy unowned clients. The same scope drives the timer's client picker, dashboards, reports and search.
- **Why:** Owner instruction: "only the Manager should have permission to add clients. Any client added by the Manager should automatically be visible to all employees under that Manager."
- **Where:** `lib/permissions.ts`, `services/scope.ts` (`clientScopeFilter`), `components/clients/clients-view.tsx`.

### A62. Chat is realtime by design (owner change, 22 Sep 2026)
- **What:** Reported: "new message only appears after refreshing". Fixes: (1) room joins are durable - `joinRoom()` queues until the socket is connected and every (re)connect replays all joined rooms, so a join emitted before the socket existed or lost on reconnect no longer drops delivery; (2) after a reconnect the open thread and conversation list are re-fetched (catch-up), and a 15-second poll plus a refetch on tab focus backstop delivery; (3) sending is optimistic - the bubble appears instantly (dimmed with a clock), is swapped for the server copy when confirmed, and is marked "not sent" on failure; (4) the realtime context is memoised so chat effects no longer re-run (leave/rejoin/refetch churn) on every provider render; (5) employees could not start a DM because the people picker used `/api/employees`, which the Employee role may not read - `GET /api/chat/people` (any role with chat access) now lists active colleagues. Measured on the production build: sender bubble ~70 ms, recipient ~180 ms, and delivery after the recipient's connection drops and reconnects.
- **Where:** `hooks/useRealtime.tsx`, `hooks/useChat.tsx`, `components/chat/{thread,chat-view}.tsx`, `app/api/chat/people/route.ts`, `services/chatService.ts` (`listChatPeople`).

### A63. No re-loading on revisits: router cache + client GET cache (owner change, 22 Sep 2026)
- **What:** (1) `experimental.staleTimes` (dynamic 60 s, static 300 s) keeps visited pages in Next's client router cache, so returning to a page within a minute renders instantly without a server round-trip or a loading skeleton. (2) `lib/api/client.ts` caches GET responses for 5 minutes with stale-while-revalidate: a cached URL is returned at once and refreshed in the background; in-flight GETs are de-duplicated. The cache is cleared on every non-GET call, every realtime event (each audited write emits one) and every socket reconnect, so views that refetch after a change always see fresh data. Time-derived payloads (`/api/timer`, `/api/dashboard/status`, chat threads) always bypass the cache (`fresh: true`). Measured: page revisits make no server requests; MongoDB Atlas round-trip is ~35-40 ms from this machine (cluster in another region), which is why a first visit takes ~200 ms.
- **Why:** Owner report: "database always loading ... once it was loaded it should not again and again fetching".
- **Where:** `next.config.ts`, `lib/api/client.ts`, `hooks/useRealtime.tsx`, `hooks/useTimer.tsx`, `hooks/useChat.tsx`, `components/dashboard/live-status.tsx`.

### A64. Installable PWA + Android (TWA) packaging (owner request, 22 Sep 2026)
- **What:** The app is a Progressive Web App: `app/manifest.ts` (standalone display, icons, shortcuts), `public/sw.js` (cache-first for hashed static assets and icons, network-first navigations with `public/offline.html` as fallback; API/page data are never cached by the worker), `components/layout/pwa-register.tsx` (registers the worker in production only), PWA metadata/viewport in `app/layout.tsx`, and `/.well-known/assetlinks.json` served from `ANDROID_PACKAGE_NAME` + `ANDROID_CERT_SHA256` so an Android Trusted Web Activity can run full-screen. Icons are generated placeholders in `public/icons/` (replace with the real brand PNGs, 192/512 + maskable). An APK/AAB is produced from the *hosted* HTTPS URL with PWABuilder or Bubblewrap - it cannot target localhost.
- **Where:** `app/manifest.ts`, `public/sw.js`, `public/offline.html`, `public/icons/*`, `components/layout/pwa-register.tsx`, `app/.well-known/assetlinks.json/route.ts`, `app/layout.tsx`, `middleware.ts`, `.env.example`.

### A65. Android/iOS apps via Capacitor in remote-URL mode (owner request, 22 Sep 2026)
- **What:** `capacitor.config.ts` (appId `com.broaddcast.workpulse`, appName WorkPulse) loads the deployed site instead of a bundled export - `output: "export"` is impossible here (76 API routes, middleware, Auth.js, Socket.IO). `androidScheme`/`iosScheme: "https"` plus `hostname: app.broaddcast.com` make the WebView origin the real domain, so the existing `SameSite=Lax` session cookie stays first-party: **no auth changes were required**. Native projects generated in `android/` and `ios/`; icons (all densities + adaptive), splash screens and brand colours generated; permissions limited to INTERNET, ACCESS_NETWORK_STATE, POST_NOTIFICATIONS; verified app links (`assetlinks.json`, `apple-app-site-association`) served from env vars. `components/layout/native-bridge.tsx` handles status bar, splash, Android back button, foreground refetch, offline toast and push registration - all Capacitor imports are lazy and gated on `isNativePlatform()`, so the web bundle only gains a 7.6 KB chunk the website never loads. Push: `DeviceToken` model, `POST/DELETE /api/me/devices`, and FCM HTTP v1 delivery (`lib/push`) called from the existing `notify()`, so all ten notification types deliver natively with no duplicate logic; inactive until `FIREBASE_SERVICE_ACCOUNT` is set. Mobile nav is Home / Timer / Tasks / Chat / Profile. `lib/db/scoped.ts` gained tenant-scoped `deleteOne`/`deleteMany` (used for token cleanup).
- **Not changed:** chat realtime (already A62), timer reliability (already server-segment based), skeletons/empty/error states/toasts, existing APIs, MongoDB, auth. The website build and behaviour are unchanged.
- **Limitation:** no JDK/Android SDK on the development machine, so no APK/AAB could be produced here; commands are documented in `MOBILE.md`.
- **Where:** `capacitor.config.ts`, `android/**`, `ios/**`, `components/layout/{native-bridge,mobile-nav,user-menu}.tsx`, `lib/{native.ts,push/index.ts,db/scoped.ts,env.ts}`, `models/DeviceToken.ts`, `services/notificationService.ts`, `app/api/me/devices/route.ts`, `app/.well-known/apple-app-site-association/route.ts`, `app/layout.tsx`, `app/globals.css`, `MOBILE.md`.

### A67. Every page responsive from 320px to 1440px+ (owner request, 22-23 Sep 2026)
- **What:** `Table` gained a `cards` mode (default on): below `md` each row renders as a card, the header row is hidden and each cell shows its column name from `TD`'s new `label` prop; `primary` marks the cell that becomes the card heading and `hideOnMobile` drops cells the heading already covers. Applied to tasks, employees, invites, clients, timesheets, attendance, live status, companies, audit log and payment history. Wide numeric report tables keep the grid (`cards={false}`) and instead pin their first column (`.table-sticky-1`) so the row identity stays visible while scrolling. Between `md` and `lg` all tables get tighter cells and a pinned first column. Other fixes: report date presets became one swipeable pill row, KPI labels wrap instead of truncating on phones, the calendar opens on the day list on phones (a 7-column month grid is unreadable at 390px) and its cells are shorter, kanban columns are `78vw` so the next column peeks, the audit log's expanded JSON wraps instead of widening the table, and its Role/Last-active columns appear only from `2xl`.
- **Verified:** an automated pass over 40 page-visits per role (Super Admin, Manager, Employee) at 320, 360, 390, 414, 768, 1024, 1280 and 1440px reports no page overflow and no table scrolling sideways outside the report views.
- **Where:** `components/ui/table.tsx`, `app/globals.css`, `components/{tasks/task-table,employees/employees-view,clients/clients-view,timesheets/timesheets-view,attendance/attendance-view,dashboard/status-table,dashboard/companies-table,admin/audit-viewer,settings/subscription-view,reports/report-views,reports/report-shell,reports/daily-views,calendar/calendar-view,tasks/kanban-board,dashboard/stats-card}.tsx`.

### A68. Daily report reduced to one question (owner change, 23 Sep 2026)
- **What:** `/daily-report` now asks only **"What did you complete today?"** (a larger textarea). The other four questions - what you are working on, what is pending, are you blocked, what you will work on tomorrow - are removed from the form, from the manager view at `/reports/daily` (which also loses the "Blocked" KPI, the red card highlight and the "blocked" badge in the employee's own history) and from the serialized API response. The `DailyReport` model keeps its `inProgress`, `pending`, `blockers` and `tomorrow` columns and `dailyReportSchema` still accepts them (optional), so existing rows and any older client keep working; nothing is deleted from the database.
- **Where:** `components/reports/daily-views.tsx`, `lib/validation/reports.ts`, `services/dailyReportService.ts`.

### A69. Services a client has taken from us (owner request, 23 Sep 2026)
- **What:** `Company.services` is a company-owned catalogue of what you sell (Creatives, Meta Ads, Google Ads, Truecaller, ...), maintained by the Company Admin in **Settings > Company > Services you offer** (add/remove chips, suggestions, duplicates dropped case-insensitively). `Client.services` records which of those a client has taken: the client dialog shows them as a **checkbox grid** ("What have they taken from us?"), ticked ones highlighted in the brand colour. Selected services appear as chips in the Services column of the clients table (first three plus a "+N" chip) and in a "Services taken" card on the client detail page. A service later removed from the catalogue stays ticked on clients that already have it (it is still rendered and still editable). `GET /api/company/services` serves the catalogue to anyone who can view clients. The designations editor (A57) was generalised into `components/settings/list-editor.tsx`, which now drives both lists.
- **Where:** `models/{Company,Client}.ts`, `lib/validation/{company,clients}.ts`, `services/{companyService,clientService}.ts`, `app/api/company/services/route.ts`, `components/settings/list-editor.tsx`, `components/clients/{client-dialog,clients-view}.tsx`, `app/(dashboard)/{settings,clients/[id]}/page.tsx`, `hooks/usePickers.ts`, `components/tasks/types.ts`.

### A70. Company Admin can add clients again; admin clients are company-wide (owner change, 23 Sep 2026)
- **What:** Amends A61. `clients.create` is restored for COMPANY_ADMIN alongside MANAGER. A client created by an admin has no owning manager, so it is stored with `sharedWithCompany: true` and is visible to **everyone in the company**; a client created by a manager still belongs to that manager and is visible to their people (plus legacy clients with no creator, and clients of projects you are a member of). The Clients page description now states both rules.
- **Why:** The owner reported "add client is not coming for admin" and chose "Admin adds, visible to everyone" over assigning an owning manager.
- **Where:** `lib/permissions.ts`, `models/Client.ts` (`sharedWithCompany`), `services/{clientService,scope}.ts`, `components/clients/clients-view.tsx`.

### A71. Menu visibility: hide sidebar items per role during a staged rollout (owner request, 23 Sep 2026)
- **What:** A new Company Admin page, **Sidebar > ADMIN > Menu visibility** (`/admin/navigation`), lists every sidebar item for each of the four company roles (Employee, Team Lead, Manager, Company Admin) as a checkbox, grouped exactly as the sidebar groups them. Unticking an item removes it from that role's sidebar, from the phone "More" drawer (both render the same `SidebarNav`) and from the phone bottom bar, which drops the tab and narrows its grid so the Timer stays centred; a per-role badge counts what is hidden, `Hide all` / `Show all` flip one role, and **`Show everything`** clears all four at once and saves immediately - that is the button to press when the rollout is finished. The list is stored on `Company.hiddenNav` (one array of hrefs per role) and saved through the existing `PATCH /api/admin/company`.
- **Scope:** Hiding is **menu-only**. It does not change permissions and a direct URL still works, so it is a rollout tool, not an access control; to actually revoke access, change the role or the permission matrix. `/admin/navigation` itself is in `ALWAYS_VISIBLE` and can never be hidden, otherwise an admin could lock themselves out of the page. The session payload reads the company on every request, so a change takes effect on the user's next page load - no re-login.
- **Verified:** hiding Clients, Projects, Calendar and Announcements for EMPLOYEE left the employee sidebar with Dashboard, Tasks, Timer, Sheets, Attend, Report, Roles, Chat, Alerts, Reports and Time, while the admin's own sidebar was untouched. On a 390px phone, hiding Tasks and Chat reduced the bottom bar from Home/Tasks/Timer/Chat/Profile to Home/Timer/Profile, and clearing the list restored all five.
- **Where:** `models/Company.ts` (`hiddenNav`), `lib/validation/company.ts`, `lib/auth/session-service.ts`, `types/index.ts`, `config/navigation.ts` (`navigationFor(role, hidden)`, `ALWAYS_VISIBLE`), `components/layout/{sidebar,mobile-nav}.tsx`, `components/admin/nav-visibility.tsx`, `app/(dashboard)/admin/navigation/{page,loading}.tsx`.

### A72. WhatsApp-style chat, attachments and team channels (owner request, 23 Sep 2026)
- **What:** The chat was rebuilt around the existing Socket.IO layer rather than replaced. **Ticks** on your own messages now run grey tick (saved) -> grey double tick (the recipient's browser acknowledged it over the socket) -> blue double tick (they opened the conversation); in a group both ticks mean *everyone* has it, and reading always implies delivery so a blue tick can never sit above a missing grey one. `Message.deliveredTo` is the new receipt list; the recipient's thread posts `/api/chat/delivered` for whatever it has on screen. **Attachments** are now plural: up to 10 photos and documents go in one message, staged first as thumbnails and document cards that can be added to or removed before sending, with a caption that travels with them. Images render as a WhatsApp-style tile grid (a fourth tile counts the rest) that opens a full-screen viewer with arrow keys and a download; documents render as cards with icon, type and size. Every file downloads through `/api/chat/messages/:id/attachments/:attachmentId`, which checks conversation membership and sets `Content-Disposition`, so a file keeps its real name and a non-member gets a 404 instead of a usable link. **The UI** is a rebuild: one search box that both narrows the chat list and searches message text, All / Unread / Channels filters, presence dots, ticks and unread pills in the list, bubbles with tails and in-bubble timestamps, day separators, an unread rule, a typing bubble, a jump-to-latest button and a faint wallpaper behind the thread.
- **Channels:** `Conversation.type` gained `channel` - a named channel with its own description and explicit member list, created and managed by Team Leads and above (`chat:manage`, which Employees do not have). The owner or a Company Admin can rename it, edit the description, add and remove members, archive it (history kept, nobody can post) or delete it with its messages and files. The automatic one-per-Team and one-per-Project channels are untouched, so team and project chat keep working exactly as before. Only members see a channel, with one deliberate exception: a **Company Admin sees every channel in their company**, which matches how they already see every team channel and keeps moderation possible. The owner cannot be removed from their own channel.
- **Watch out:** `channelPatchSchema` is written out by hand instead of `channelSchema.partial()`, because `partial()` keeps `members`' `.default([])` and a PATCH that only renamed a channel arrived with `members: []` and emptied it. There is a regression check for this.
- **Verified:** 31 automated checks against a throwaway company with two live browsers and real sockets - one/two/blue ticks in the right order, a message arriving with no refresh, typing indicators, 3 images + 1 PDF sent as one message with previews beforehand, download with the correct filename, a non-member getting 404 on that file, channel create/rename/archive, add and remove members, an employee refused channel creation, a non-member unable to see or open a channel, a removed member losing access at once, a rename leaving members intact, and no horizontal overflow at 390px on both the list and the thread.
- **Where:** `models/{Message,Conversation}.ts`, `lib/validation/chat.ts`, `lib/permissions.ts`, `lib/storage/index.ts` (`imageSize`), `services/chatService.ts`, `app/api/chat/**`, `hooks/useChat.tsx`, `components/chat/{chat-view,conversation-list,thread,message-bubble,composer,attachments,channel-dialog}.tsx`, `app/globals.css`.

### A73. Full emoji set, live read ticks, forwarding and a message sound (owner request, 23 Sep 2026)
- **Read ticks without a refresh (bug fix):** `chat:read` was only emitted to the conversation room, which reaches people who have that thread open and nobody else. Anyone sitting on the chat list therefore kept a grey tick on their own last message until they reloaded, and a reader's unread badge stayed lit in their other tabs. The receipt is now also sent to every member's user room, and the client updates the list from it: your row turns blue when they read it, and your badge clears everywhere when you read it. A channel row still waits for the next list refresh, because one person reading does not mean everyone has.
- **Emoji:** the 32-emoji strip became the full Unicode set - 1,914 emoji in the nine categories WhatsApp shows, with search by name and a Recent tab backed by `localStorage`. `unicode-emoji-json` is a **dev dependency only**: `npm run build:emoji` trims it into `lib/emoji-data.json` (~80 KB), which the picker imports dynamically, so nothing emoji-related is in the main bundle and the data loads only when the picker is first opened.
- **Forwarding:** any message can be forwarded to up to 10 other chats. Each target gets its own message labelled "Forwarded", and **every attachment is copied to its own storage object** - `StorageDriver.copy` - so deleting the original later cannot take the forwarded file with it. Targets the forwarder cannot post to (not a member, archived) are skipped rather than failing the whole request; a message you cannot see cannot be forwarded at all.
- **Sound:** a short two-note chime, synthesised with the Web Audio API rather than shipped as a file, plays on any incoming message anywhere in the app - the conversation you already have open mutes itself. A speaker button in the chat header toggles it and the choice is remembered per browser. Turning it on also asks once for desktop-notification permission (never on page load), after which a banner appears for messages that arrive while the tab is in the background.
- **Watch out:** browsers refuse audio before the person has interacted with the page, so the first chime of a session can be silent; the audio context is created lazily and a refusal is swallowed. `ImageKit.copyFile` is deliberately not used for forwarding, because it keeps the source filename and would collide in the destination folder - the driver re-uploads under the new key instead.
- **Verified:** 15 further checks on top of the 31 from A72 (both suites green) - the list tick turning blue with no reload, an unread badge clearing in a second tab, the picker's categories and name search, inserting an emoji, forwarding text + file, the "Forwarded" label, the forwarded file surviving deletion of the original, refusing to forward a message you cannot see, and the sound toggle persisting.
- **Where:** `services/chatService.ts`, `hooks/{useChat,useRealtime}.tsx`, `lib/{chat-sound.ts,emoji-data.json}`, `lib/storage/{types,imagekit}.ts`, `lib/validation/chat.ts`, `models/Message.ts`, `app/api/chat/forward/route.ts`, `components/chat/{emoji-picker,forward-dialog,message-bubble,thread,composer,chat-view}.tsx`, `scripts/build-emoji.mjs`.

### A74. Online/offline was wrong in production: presence no longer depends on a socket (owner report, 23 Sep 2026)
- **What was wrong:** presence lived only in `lib/realtime/presence.ts`, an in-memory map filled by Socket.IO heartbeats. That map is only populated inside a process that owns the Socket.IO server. **app.broaddcast.com runs on Vercel**, where the custom `server.ts` never runs - `GET /socket.io/...` answers 308 then 404 - so no socket ever connected, nothing ever wrote to the map, and `presence.isOnline()` returned false for everybody. Every colleague showed as Offline, permanently. Locally, where `npm start` does run the custom server, presence was already correct in all nine scenarios tested, which is why this had not shown up before.
- **The fix:** presence now has two sources and takes whichever is available. `isOnlineUser(id, lastActiveAt)` answers true if the socket store says so (exact and instant), otherwise if `User.lastActiveAt` is younger than 75s. The browser keeps that column fresh: `RealtimeProvider` beats every 30s, over the socket when one is connected and to `POST /api/me/presence` when one is not. That endpoint stamps `lastActiveAt` and returns everyone in the company who is currently online, which the client applies to the chat list and the thread as a `presence:sync` event - so dots go green and grey without a reload even where no socket exists. A 6s grace period after page load stops the fallback firing on a host that does have sockets.
- **Closing a tab still goes offline at once** where sockets exist: the store records `offlineAt` when it watches a socket leave, and a `lastActiveAt` written *before* that moment is ignored. Without this the fallback kept people green for another 75s after they closed the tab.
- **Limits, and they matter:** with no socket, presence is accurate to about a minute rather than instantly, and `lastActiveAt` means "their browser has the app open", not "they are looking at it". A tab left open overnight reads as online. Consumers updated: chat list, conversation members, the people picker and the dashboard live-status table. `User` gained a `{ companyId, lastActiveAt }` index for the every-30s query.
- **This is a workaround for the host, not a cure.** On Vercel there is still no WebSocket, so new messages arrive on the 15s catch-up poll rather than instantly, typing indicators never reach anyone, and read receipts only move on a refetch. Moving to a host that keeps a Node process alive (Railway, Render, Fly, a VPS) makes all of that work with no code change, because the custom server is already written.
- **Verified:** 13 checks with the socket deliberately blocked at the browser (what Vercel looks like), with it available (no regression), and mixed - plus the nine-scenario probe and both chat suites (31 + 15) still green.
- **Where:** `lib/realtime/presence.ts`, `app/api/me/presence/route.ts`, `hooks/{useRealtime,useChat}.tsx`, `services/{chatService,dashboardService}.ts`, `models/User.ts`.

### A75. Stop the failed-WebSocket loop on hosts without a socket server (owner report, 23 Sep 2026)
- **What was wrong:** `socket.io-client` cannot tell "this host has no Socket.IO server" from "the connection blipped", so on Vercel it retried forever and every attempt printed `WebSocket connection to 'wss://app.broaddcast.com/socket.io/?EIO=4&transport=websocket' failed` in the console - endlessly, on every page, for every user.
- **What changed:** the provider now probes once per tab. A single `GET /socket.io/?EIO=4&transport=polling` either returns an Engine.IO handshake (a payload starting `0{`) or it does not; the answer is cached in `sessionStorage`. When there is no server **no socket is ever created**, so there are no failed connections and no console noise. When there is one, nothing changed at all.
- **Making HTTP mode actually usable:** without a socket nothing can be pushed, so the app compensates. The thread poll drops from 15s to **4s** while the tab is visible, and the conversation list refreshes every third tick. A hidden tab keeps a slower watch (every ~16s) instead of stopping, because otherwise a message arriving while the tab was behind another would never chime or raise a banner - exactly when you want it to. Messages found by polling now fire the same chime and desktop notification a pushed message would, by watching for unread counts that went up. The notification badge refreshes on the presence beat, since `notification:new` never arrives either.
- **Still not possible without a socket:** typing indicators (they would need a write per keystroke), and true instant delivery - messages land within a few seconds rather than immediately. Both work the moment the app runs somewhere with a live Node process.
- **Verified:** 13 checks with `/socket.io` stubbed to 404 in the browser, which is what production does - one probe request and no retries over 25s idle, zero WebSocket errors in the console, presence correct, a message arriving with no refresh, a hidden tab still noticing new messages, replies flowing back - plus a socket-enabled context confirming it still connects normally, and the A72/A73/A74 suites (31 + 15 + 13) still green.
- **Where:** `hooks/{useRealtime,useChat}.tsx`.

### A76. Real-time on Vercel: an Ably transport behind the existing adapter (owner decision, 23 Sep 2026)
- **Why:** Vercel cannot run a WebSocket server, so `server.ts` never starts there (A75). The owner chose to stay on Vercel and add a hosted realtime service rather than move hosting, and picked **Ably** for its free tier (200 concurrent connections, 6M messages/month).
- **How it fits:** `RealtimeAdapter` already existed for exactly this. `realtime()` now returns, in order: the Socket.IO adapter when the custom server is running in this process, the Ably adapter when `ABLY_API_KEY` is set, otherwise a no-op. Feature code is unchanged - it still calls `emitToCompany` / `emitToUser`.
- **Delivery model changed (the significant part):** `emitToRoom` is gone, replaced by `emitToUsers(ids, ...)`. Conversation traffic used to go to a shared `conversation:<id>` room that clients joined after a membership check. With a hosted pub/sub service the browser holds a token, and scoping a token to every conversation a person is in - refreshed whenever they open another - is fragile. Now the **server** resolves the members and addresses each of them, so a DM cannot be delivered to, or subscribed to by, anyone outside it. A browser's token can only ever read `user:<their own id>` and `company:<their company>`. This also removed `chat:join` / `chat:leave` and the socket typing relay: typing now goes through `POST /api/chat/typing`, one path for every transport, with the membership check on the server.
- **Presence:** the Ably `company:<id>` channel doubles as the presence set, so entering it is what marks someone online and leaving is immediate - no heartbeat window. The HTTP beat still runs to keep `User.lastActiveAt` fresh for server-rendered pages, but under Ably it does not publish `presence:sync`, or the 75s database view (A74) would overwrite the exact one.
- **Nothing here can break chat.** A missing key, an unusable key, or a key that cannot connect all fall through to Socket.IO and then to polling: the token endpoint answers `provider: null` instead of 500, and the browser gives the service 8s to connect before moving on.
- **Pinned to `ably@2.17.1` deliberately.** 2.18+ ships a build that Next's SWC loader mis-compiles - the bundle fails with `Module parse failed: 'super' keyword outside a method`. Do not widen this range without rebuilding. The client imports `ably/modular`, not `ably`: the default browser entry is a UMD bundle webpack cannot parse, and the modular build only pulls in the transport and presence actually used.
- **CSP:** `connect-src` gained `https://*.ably.net` and `wss://*.ably.net` (plus the older `ably.io` / `ably-realtime.com` hosts). Ably resolves to `main.realtime.ably.net`; without this the browser blocks the connection and chat silently drops to polling.
- **Setup:** create an app at ably.com, copy a key with publish/subscribe/presence, set `ABLY_API_KEY` in the Vercel project, redeploy. Nothing else changes; with the key absent the app behaves exactly as before.
- **Verified:** 8 checks with a well-formed but fake key - the token endpoint answers 200, reports the provider, returns a signed token request, scopes it to that user's own two channels only, never mentions another user's channel, falls through to Socket.IO when the key cannot connect, still delivers chat, and raises no uncaught errors. Plus the A72/A73/A74/A75 suites (31 + 15 + 13 + 12) with the key unset. **A live Ably round-trip has not been tested** - that needs a real account key.
- **Where:** `lib/realtime/{adapter,index,ably,socketio}.ts`, `lib/env.ts`, `app/api/realtime/token/route.ts`, `app/api/chat/typing/route.ts`, `services/chatService.ts`, `hooks/{useRealtime,useChat}.tsx`, `next.config.ts`, `.env.example`.

### A77. Daily reports go to the team lead, and lock when the day ends (owner request, 24 Sep 2026)
- **Routing:** submitting a daily report now notifies the **lead of the team the employee belongs to** (`User.teamId` -> `Team.leadId`), as a `DAILY_REPORT` notification carrying a 140-character preview and a link to `/reports/daily?date=<that day>`, which now opens on that day instead of always on today. Where the team has no lead the notification falls back to the team's manager, and then to the employee's own `managerId`, so a report is never submitted into silence; with none of those set, nobody is notified. The author is never notified about their own report.
- **Notified once, on first submission.** Same-day edits stay quiet on purpose: people revise their own wording through the day and a ping per save would be noise. The lead sees the current text whenever they open the page, and the audit log still records every update.
- **Locking:** a report belongs to its own day. It can be written and rewritten all through that day and is read-only afterwards. The server is the rule - `submitDailyReport` rejects any date that is not the company-timezone today, with `REPORT_LOCKED` for a past day and `FUTURE_DATE` for a future one. The page matches it: today shows the textarea and a submit button, a past day shows the text in a read-only panel with a lock icon, "Locked - submitted ...", and a "Back to today" button.
- **This removes back-filling.** Previously any past date could be submitted. That had to go: if yesterday could still be created, the lock would be decorative. Anyone who misses a day now has no report for it, which is what the "submitted 7 / 9" count on the manager view is for.
- **"Today" is the company's timezone day on both sides.** The form derives it from `company.timezone` via `dayKey`, not from the browser, so someone working in another timezone is never shown an editable box the server then refuses.
- **The history is dates only** - the "Past work reports" card lists the date of each of the last 30 days' reports, with a lock icon on the closed ones and a "Today" marker on the open one; opening a row reads it.
- **Verified:** 19 checks on a fresh company with a real team (lead + employee on it) - the lead is notified with the right title, preview and link, sees the content, an unrelated colleague is neither notified nor able to read it, a same-day edit works and does not re-notify, yesterday returns `REPORT_LOCKED` and tomorrow `FUTURE_DATE`; plus 7 more against database-seeded past days confirming the locked day has no textarea, no submit button, shows its text read-only and offers a way back to today.
- **Where:** `services/dailyReportService.ts`, `components/reports/daily-views.tsx`, `types/index.ts` (`DAILY_REPORT`), `components/layout/notification-bell.tsx`.

### A78. The team's daily reports had no sidebar link (owner question, 24 Sep 2026)
- **What was wrong:** `/reports/daily` - the page that shows everyone's daily report beside their tracked hours - was not in the navigation at all. The only daily-report link was **TIME > Daily Report**, which goes to `/daily-report` and renders the caller's *own* form for every role, team leads included. A lead could only reach their team's reports by typing the URL, or by clicking the notification added in A77. Asked "where do I see who submitted", the honest answer was "you cannot, from the UI".
- **Fixed:** a **TEAM > Daily Reports** item pointing at `/reports/daily`, limited to Company Admin, Manager and Team Lead. Employees are excluded deliberately: they already have their own form under TIME, and this page would only ever show them their own row again.
- **Why the TEAM group and not ANALYTICS:** the collapsed rail shortens labels, and "Team Reports" under ANALYTICS became "Team", sitting directly under "Teams". Under TEAM, next to Employees / Teams / Roles, it reads as the team's daily reports and shortens to "Daily".
- **Verified:** 9 checks - a lead sees the link and still has their own Daily Report link, clicking it opens the team view showing who submitted, what they wrote and a submitted count, people who have not submitted are listed as "not submitted", an employee gets no such link, and the API returns only their own row to them.
- **Where:** `config/navigation.ts`, `components/layout/sidebar.tsx` (rail label).

### A79. Filters on the daily reports page (owner request, 24 Sep 2026)
- **What:** `/reports/daily` gained the same filter row the other report pages use - **From / To** with presets (Today, Yesterday, This week, 7 days, This month, 30 days), **Team** (hidden for a Team Lead, who has one), **Employee**, and a **Status** of All / Submitted / Not submitted - plus a Clear button and arrows that step the whole window back and forth. The default is still today, so the everyday "who has filed?" glance is unchanged; widening the range is what lets someone follow one person over a fortnight.
- **Shape of the answer:** the API returns the range grouped by day, newest first, with a heading per day ("23 Sep 2026 - 2 of 3 submitted", marked when it is not a working day). A single day renders exactly as before, without the headings.
- **Counts stay honest under the Status filter.** Choosing "Not submitted" narrows which cards are drawn but not the totals: "1 / 7" still means one report out of seven expected. Filtering the list must not change the number it is being measured against.
- **Fetched once for the window, not once per day.** `dailyReportsForRange` pulls people, time entries and reports for the whole range and groups them in memory; the old per-day helper would have meant a fortnight of round-trips.
- **Fixed while testing:** two real bugs. A back-to-front range (`from` later than `to`) only swapped one side and returned a single day - it now swaps both. And changing two filters quickly left the slower, older response on screen: the loader now ignores any answer that is not the newest request. The second was only visible because a screenshot showed a 7-day range with one day of data.
- **Scoping is untouched:** an employee still only ever sees their own row, whatever `userId` they ask for, and a Team Lead still sees only their team.
- **Verified:** 22 checks - a range returns one group per day newest first, the employee filter narrows to one person and the totals follow, `status=submitted` / `missing` filter the rows while the counts stay honest, `?date=` still returns a single day (the A77 notification link), a backwards range is corrected, an employee is still confined to themselves, every filter control renders, choosing a person drops the others from the page, and a 7-day range renders seven day headings with a "1 / 7" total.
- **Where:** `services/reportService.ts` (`dailyReportsForRange`), `app/api/reports/daily/route.ts`, `lib/validation/reports.ts` (`status`), `components/reports/daily-views.tsx`.

### A80. Past work reports show what was written, not just the date (owner change, 24 Sep 2026)
- **What:** each row of the employee's "Past work reports" card now carries the report text underneath its date, clamped to three lines, with the lock icon and the "Today" marker still on the right. Opening a row still shows it in full in the read-only panel. The list scrolls once it is taller than the card.
- **Why this reverses part of A77:** that entry said the history should show the date only. Seeing it in use, the owner asked for the content back - a column of bare dates says nothing about what the fortnight contained. The locking behaviour from A77 is untouched; this is only what the list displays.
- **Verified:** 7 checks - every row shows its date, today's row shows what was just submitted, both seeded past days show what was written then, the lock and Today markers survive, and opening a past row still reads it in full and still says locked.
- **Where:** `components/reports/daily-views.tsx`.

### A81. A launcher home screen, on the phone and on the desktop (owner design pick, 24 Sep 2026)
- **What:** the dashboard home was redrawn for every role around one idea - the day on top, everything else as a tile you tap. On a phone: a cocoa header with the greeting, the company name, the date and the avatar; the timer card lifted over it; a 3-column grid of round-icon tiles; one line saying what needs attention; and a single full-width **Clock in** / **Clock out for the day** button. On desktop the same day sits landscape - a dark timer card beside a green clock-in card (`DayHero`) - with the same tiles as a row of wide cards above the existing cards.
- **Where the design came from:** the owner reviewed a canvas of directions and picked the launcher (E1), asking for the running-timer treatment from E2 and the same design on desktop.
- **One list drives both.** A page declares its tiles once as `LauncherTile[]`; `MobileHome` renders the phone grid and `QuickTiles` the desktop row from that same array. Tiles carry live numbers - open tasks, hours today, whether the daily report is written - so the grid is a status board, not a menu.
- **Colour groups the tiles rather than decorating them:** green is time, brown is work, blue is admin. Every fill is dark enough to carry white icons and text.
- **A tile names its icon; it does not carry it.** `icon: "tasks"` is resolved to a Lucide component inside the client through `TILE_ICONS`. Passing the component itself is what produced "Functions cannot be passed directly to Client Components" in A69 - the dashboard pages are server components, and an icon is a function.
- **Menu visibility governs the tiles too.** Both grids run their list through `visibleTiles`, which keeps only hrefs that `navigationFor(role, hiddenNav)` still allows. Hiding a page in Admin > Menu visibility (A71) hides its tile as well - otherwise the home screen would be a back door to a page the sidebar is hiding. This was a real bug in the first cut: the phone grid filtered, the desktop row did not, and a hidden page kept its desktop card.
- **The bell lives in the app bar, once.** The first cut put a second bell in the hero, a centimetre below the sticky one; the hero keeps the avatar and date.
- **Verified:** 23 checks - the phone home renders with no console errors for employee, admin and lead, shows a 9-tile grid, the greeting and the timer card, has no horizontal overflow at 390px, and clocking in from it flips the button to "Clock out for the day" in place; the desktop hero, tile row and the existing cards all render; and hiding `/projects` and `/calendar` for employees drops exactly those two tiles while the rest survive.
- **Where:** `components/dashboard/tiles.tsx` (new), `components/dashboard/day-hero.tsx` (new), `components/dashboard/mobile-home.tsx`, and the four `app/(dashboard)/*/dashboard/page.tsx` pages.

### A82. A Windows app, and one public link to download both apps (owner request, 24 Sep 2026)
- **What:** an Electron shell in `desktop/` gives WorkPulse a Windows app, built the same way as the mobile one (A65) - a native window around the *deployed* site rather than a copy of it, so a Vercel deploy updates every installed app and the session cookie stays first-party. A public `/download` page hands out the Android APK and the Windows installer, and `.github/workflows/apps.yml` builds both on GitHub's runners.
- **Why CI and not this PC:** the owner's machine has no JDK and no Android SDK (which is why A65 never produced an APK), and Windows refuses electron-builder's code-signing unpack without Developer Mode. GitHub's runners have all of it and Actions is free for this repo, so both builds live there. A tag like `v1.0.0` also publishes a release with both files attached.
- **The desktop app is kept out of the web build.** `desktop/` has its own `package.json`, is excluded from `tsconfig.json`, and its `node_modules` and `dist` are git-ignored, so a root `npm install` and the Vercel build never see Electron.
- **`/download` is public on purpose** (added to `PUBLIC_PATHS` in `middleware.ts`): somebody who has not signed in yet still has to be able to fetch the app. It reads `DOWNLOAD_ANDROID_URL`, `DOWNLOAD_WINDOWS_URL` and `DOWNLOAD_VERSION` from the environment, renders at request time, and shows "Not published yet" for a platform whose URL is empty rather than offering a link that 404s. It also covers the two free routes that need no file at all: installing from Chrome or Edge, and Add to Home Screen on iPhone, where Apple allows nothing else.
- **The files are handed out from this domain, not from GitHub.** The repository is private, so its release assets cannot be linked to directly - GitHub would ask the person to sign in. `/download/android` and `/download/windows` ask the API for a short-lived signed URL and **redirect** to it, so the binary never travels through this server: no bandwidth cost, and no serverless function trying to stream 90 MB. The page itself lists whatever the latest release actually contains, with each file size, and the token is optional so a public releases repo would work with no token at all.
- **Fixed after the owner tried it: the page assumed you were signed out.** Its two links pointed at `/login`, and middleware sends an already-signed-in person from `/login` to their dashboard - so clicking anything on the download page appeared to throw you into the app. The page now checks for the session cookie (presence only; it just decides where a link points) and offers "Open WorkPulse" pointing at `/` instead, with "You are signed in already" in place of the invitation to sign in. `/download` itself never redirected - it answered 200 throughout.
- **The redirect back is relative, and the handler cannot 500.** The first version built an absolute URL from `APP_URL`; in production that returned an empty 500 for every platform, including ones that never reach the release lookup, while the same code redirected correctly locally. A relative `Location` is valid HTTP, the browser resolves it against the request, and it needs neither `APP_URL` nor the request URL - so there is nothing left to construct and nothing left to throw. The handler also catches, because a download link must never answer with a blank page.
- **Nothing is ever answered with raw JSON.** Following `/download/android` before a build exists used to return `{"error":"That app has not been published yet."}` in the browser. It now redirects back to `/download?unavailable=android`, and the page carries a line saying that app has not been published yet - an unknown platform redirects to the page with no notice at all.
- **The installer is unsigned,** so SmartScreen warns on first run and the page says so. A certificate is the only fix and it is a paid, yearly one.
- **Three traps found while building, all documented in `DESKTOP.md`:** electron-builder 26 hits `EPERM` renaming its extraction folder on a machine with live virus scanning (the repo stays on 25, which does not); its signing tool unpacks macOS symlinks and needs Windows Developer Mode; and a VS Code terminal exports `ELECTRON_RUN_AS_NODE=1`, which makes any Electron binary run as plain Node and exit at once - that is why the packaged app first appeared to start and immediately die.
- **Verified:** 25 checks - the packaged `WorkPulse.exe` opens, loads `https://app.broaddcast.com`, renders the real login page (not the offline fallback) and exposes `window.workpulseDesktop`; and `/download` opens with no session without bouncing to login, answers 200 with no page errors, offers both platforms with the right file links and the version, explains iPhone, and does not overflow at 390px. With releases configured the page picks the right asset per platform and shows its size, `/download/windows` answers 302 with a signed storage URL, and unconfigured or unknown platforms 404 with a plain message instead of an error page. Signed in and signed out are both checked: the page opens either way, no link points at `/login` for somebody who is already in, and clicking the header link lands in the app without passing through login.
- **Where:** `desktop/**` (new), `.github/workflows/apps.yml` (new), `app/download/page.tsx` + `app/download/[platform]/route.ts` (new), `lib/releases.ts` (new), `DESKTOP.md` (new), `middleware.ts`, `lib/env.ts`, `tsconfig.json`, `.gitignore`, `.env.example`.

### A83. Geofenced photo attendance, with an approval chain (owner request, 24-25 Sep 2026)
- **What:** a **swipe** is a photo, a place and a moment. The employee opens **TIME > Swipe**, the screen reads their location and tells them where they stand before they commit, they take a photo, and they tap **On duty** or **Off duty**. A swipe taken inside a work site is approved on the spot; one taken anywhere else is recorded as **pending** and goes to the **team lead, then the manager, then HR**, in that order.
- **A new HR role.** The owner chose a real sixth role over reusing Company Admin. HR sees people and attendance company-wide and owns the work sites; it deliberately has no grant over clients, projects or tasks. HR can hire - invite and edit anyone at Manager level or below - but **cannot appoint another HR or a Company Admin**, enforced in both the invite path and the role-change path rather than only in the dropdown.
- **The photo is stamped by the server, not the phone.** Anything a client draws, a client can fake. `sharp` composites the person's name, the server's clock **to the second** in the company timezone, the site and distance, and the coordinates with their accuracy - all from the same values written to the database, so the picture and the record can never disagree. A photo taken outside the app and uploaded later still carries the server's timestamp.
- **Kept separate from `Attendance`.** That stays one row per person per day and every report built on it is untouched; this is an append-only log of individual swipes. The owner chose this over replacing clock in/out.
- **A circle, not a polygon.** A site is a point and a radius: one number a person can reason about, no map editor to define it, and the test is a single Haversine calculation. The radius floor is 25 m and the UI warns below ~100 m, because phone GPS drifts 5-20 m outdoors and far more indoors - a tight fence flags people who are genuinely at their desk.
- **A chain that cannot strand a swipe.** A step is only added when there is a distinct person to fill it: a team lead does not approve their own swipe, and somebody with no manager does not wait for one. The HR step is always present and always settleable - any HR may act, and a **Company Admin may act on any step** - so a pending swipe always has someone able to decide it. Nobody decides their own swipe, whatever their role, and no step can be jumped.
- **Company Admin can manage sites too,** which softens "only HR can add location points": a company that has not appointed an HR yet could otherwise never switch the feature on.
- **Found by testing, and genuinely broken before it:** the app sent `Permissions-Policy: geolocation=(), camera=()`, which disables both outright - no amount of user permission would have helped, and the feature could not have worked in any browser. Both are now granted to this origin only; microphone and USB stay off. On Android the manifest gained the location and camera permissions; Capacitor's own `BridgeWebChromeClient` asks the person at the moment of use, so declaring them is all that was needed.
- **Verified:** 28 API checks and 14 UI checks. A swipe at the site is approved instantly and names the site; one 934 m away is pending, measures the distance and lists the chain as lead, manager, HR; the employee cannot decide their own, the manager cannot jump the lead's step and HR cannot jump to the front; approving walks lead to manager to HR and then settles; a rejection at the first step ends it; a settled swipe cannot be decided twice; a bad fix (0, 0) is refused; a radius below the GPS error is refused; and the stamped photo loads and is resized rather than stored raw. The UI pass fakes a GPS fix and drives it end to end: HR's "use my location" fills the coordinates, the swipe screen says "You are at Head Office" up close and "2.0 km from Head Office - this swipe goes for approval" far away, and the lead's queue shows the chain and approves.
- **Where:** `models/{WorkSite,AttendanceSwipe}.ts`, `lib/{geo.ts,attendance/stamp.ts,validation/swipes.ts}`, `services/{workSiteService,swipeService}.ts`, `app/api/{work-sites,attendance/swipes}/**`, `components/attendance/{swipe-view,work-sites-view,swipes-view}.tsx`, `app/(dashboard)/{swipe,work-sites,attendance/swipes,hr}/**`, `lib/permissions.ts`, `services/scope.ts`, `config/navigation.ts`, `next.config.ts`, `android/app/src/main/AndroidManifest.xml`, `types/index.ts`.

### A84. Phones lose the top bar, and get their scrolling back (owner report, 25 Sep 2026)
- **The scrolling bug was real, and it was CSS.** `app/globals.css` carried `html, body { max-width: 100%; overflow-x: hidden; }`. Per the CSS spec, when one axis is not `visible` the other computes to `auto` - so hiding the x-axis on **both** html and body turned **both** into scroll containers, which is the classic way to kill vertical scrolling on a phone. Measured on the deployed site: `html overflow-y: auto`, `body overflow-y: auto`. After the fix: `visible` on both. `overflow-x: clip` on `html` alone does the same clipping job without coercing the other axis.
- **The top bar is desktop-only now.** The sidebar already was. On a phone the bottom bar navigates and its **Profile** tab opens the full drawer, so nothing became unreachable - that was checked, not assumed.
- **The bell came back to the phone home.** A82 had removed it from the hero because it duplicated the one in the top bar; with no top bar it is the only one, so it belongs there again.
- **The drawer was cleared of suspicion.** Radix locks body scroll while it is open; the probe confirms `overflow: hidden` and `pointer-events: none` are both released on close, by Escape and by tapping outside.
- **One thing a phone loses:** the mobile search button. Search remains on desktop (and Ctrl+K); it can be added to the drawer if it is missed.
- **Verified:** 15 checks - no header or aside is painted at 390px, the bottom bar is, the page is longer than the screen and actually scrolls, neither html nor body is a scroll container, there is still no sideways scrolling, the Profile tab opens the whole menu and closing it leaves scrolling working, an inner page scrolls too, and desktop keeps both its top bar and its sidebar.
- **Where:** `app/globals.css`, `components/layout/navbar.tsx`, `components/dashboard/mobile-home.tsx`.

### A85. Swipe is the phone's centre button, and the stamp moved to the top (owner request, 25 Sep 2026)
- **The raised centre button is now Swipe,** not Timer - it is what most people open the app to do. Timer keeps a tab of its own and is tinted green while it runs, so the running state is still visible at a glance. Order is Home, Timer, [Swipe], Chat, Profile; Tasks stays a tile on the home grid and in the drawer.
- **The stamp is at the top now,** matching the attendance apps people already know, and restyled to the reference the owner sent: the brand right-aligned in gold, then name and ON/OFF DUTY, then `25/09/2026 12:59:19 PM`, then a map pin with the coordinates and the GPS accuracy, then the site and whether it was inside. A face is rarely at the top of a selfie; the old bottom band sat over the chest.
- **The pin is a drawn path, not an emoji.** Server-side SVG rendering depends on whatever fonts the host happens to have, and an emoji that renders as a box on Vercel would be a silent defect.
- **It still stamps after the shot, not on the live preview.** The reference app draws its overlay on the camera feed; that is a picture of a stamp, and anything a client draws it can also fake. Stamping server-side from the values written to the database is what makes the photo evidence rather than decoration. A live preview could be added on top of it later - it would be a nicety, not the record.
- **Verified:** the full swipe suite still passes (28 checks) and the phone-chrome suite (15), and a photo from a real end-to-end run was inspected: top band, correct date to the second, pin, coordinates and site.
- **Where:** `components/layout/mobile-nav.tsx`, `lib/attendance/stamp.ts`, `services/swipeService.ts`.

### A86. Picking a finished block of time back up (owner question, 25 Sep 2026)
- **The question:** once a job has been timed from 11:19 to 12:02 and the same job comes back later, how do you start it again without retyping the client and the description?
- **What:** every finished entry in Today's entries now carries a **Start again** button. It starts a fresh timer with the same client, project, task and description - one tap, nothing to retype.
- **It creates a new block, not a longer old one.** The 11:19-12:02 you already worked keeps its own times, and a second block starts now. Two entries against the same job is the honest record: the timesheet still shows *when* the work actually happened, and the day's total is the sum. Stretching the first entry would claim you worked straight through the gap.
- **No new API.** `startTimer` already accepted client, project, task and notes, and `useTimer.start` already handles the "you already have a timer running" case by raising the switch dialog and asking what was completed on the running one. The button is the affordance that was missing, not the machinery.
- **Description falls back** to the task, project or client name when an entry has no notes, since the timer requires a description of at least three characters.
- **Verified:** 10 checks - a finished block offers the button, pressing it starts a timer, the entry count goes up by exactly one, the original block keeps its own start time, and the new block carries the same description and the same client.
- **Where:** `components/timer/timer-page.tsx`.

### A87. One line per job, showing the total on it (owner change, 25 Sep 2026)
- **What:** Today's entries is now grouped. The same job timed twice in a day is **one line with the total time on it**, not two lines. A **N sessions** chip opens the line to show each block with its own from-to times.
- **Why this amends A86:** that entry argued two blocks was the honest record. The owner asked for the total instead, and they are right about what the list is *for* - a timesheet is read to answer "how long did this take", and making the reader add up rows is work the page should do. The blocks are unchanged underneath: nothing was merged, deleted or rewritten, and opening a line still shows exactly when each session ran.
- **What makes two blocks the same job:** the client, the project, the task and the description all match. A different description is a different job, even on the same task - two people describing the same work differently should not silently merge.
- **A running timer keeps ticking inside its group,** because the group total takes the live elapsed value for the active entry rather than its stored one.
- **Start again moves to the group** and starts from its most recent session, so the client, project and task come from the block you actually worked last.
- **Verified:** 8 checks - the API still stores each session separately, the same job renders as exactly one line, a different description keeps its own line, the line carries the combined total and a "2 sessions" chip, and opening it lists each session's own times.
- **Where:** `components/timer/timer-page.tsx`.

### A88. Tap the swipe button, get the camera (owner change, 25 Sep 2026)
- **What:** the Swipe button in the phone's bottom bar now opens the camera immediately, instead of navigating to a screen where you then press another button. When the photo comes back, a sheet asks the only things left: an optional note, and **one** action - **Off duty** if you are already on duty, **On duty** if you are not. Never both.
- **How the camera can open at all:** the file input is clicked inside the same tap that triggered it. A click fired after a route change is not a user gesture any more and browsers refuse it, which is why this is a sheet over the current page rather than a redirect to `/swipe`.
- **Duty state comes from today's swipes:** the newest one that was not rejected. A rejected swipe never puts anyone on duty, and scoping to the day means a forgotten on-duty from yesterday cannot leave someone unable to start today.
- **The location fix and the duty lookup start on the tap,** not when the photo returns, so the fix is usually ready by the time the person has taken their selfie.
- **`/swipe` still exists** for desktop and for anyone following a link, and was rewritten onto the same hook so the two paths cannot drift apart - same order, same single action, same note.
- **Verified:** 11 checks - the tap opens a file chooser (proving the gesture survives), the sheet appears with the photo, the note field and where you are, exactly one action is offered, swiping on duty is accepted, tapping again then offers Off duty and titles the sheet accordingly, and after going off duty it offers On duty again.
- **Where:** `components/attendance/{use-swipe.ts,swipe-sheet.tsx,swipe-view.tsx}`, `components/layout/{app-shell,mobile-nav}.tsx`.

### A89. The phone's menu becomes a page (owner request, 25 Sep 2026)
- **What:** tapping **Profile** used to slide a drawer over whatever you were looking at. It now opens `/profile`, a real page carrying everything the desktop sidebar holds: who you are, appearance, every navigation group the role can see, My profile, Company settings and Sign out.
- **Why a page beats a drawer here:** back works, the browser remembers it, and it can be linked to. A drawer is something to dismiss; this is somewhere to be.
- **The drawer is gone, not hidden.** Nothing opened it any more once the top bar went desktop-only (A84), so the component and its dead hamburger were removed rather than left to rot.
- **Verified:** Profile is a link rather than a drawer trigger, no dialog is left in the page, the page carries the whole menu, shows who you are, can sign you out, and browser back returns to the dashboard.
- **Where:** `components/layout/{profile-view.tsx,mobile-nav.tsx,app-shell.tsx,navbar.tsx}`, `app/(dashboard)/profile/page.tsx`.

### A90. Shifts, timings and holidays (owner request, 25 Sep 2026)
- **What:** HR gets **Shifts & holidays**. A shift is a name, a start and end time, which days count and how much lateness is tolerated; a holiday is a date nobody works. People are put on a shift from the employee form, where the choice is "Company hours" or one of the shifts.
- **They actually change the numbers,** which is the point: `personClock` layers someone's shift over the company defaults, and clock-in and clock-out use it, so **Late** and **Half Day** are judged against the hours that person is really expected to work. A holiday stops a day counting as a working day, so nobody is marked absent for it.
- **Overnight shifts were handled, not assumed away.** A shift ending before it starts crosses midnight; its length wraps instead of going negative, which a plain subtraction would have done silently.
- **Deleting a shift moves its people back to the company hours** rather than leaving them pointing at something that no longer exists, and the response says how many were moved.
- **A shift shows how many people are on it,** so HR can see what a change will affect before making it.
- **Fixed in passing:** the collapsed sidebar shortens a label to its first word, so "Swipe approvals" rendered as a second "Swipe" right below the real one. Explicit short labels now give Approvals, Sites and Shifts.
- **Verified:** 11 clock checks (a holiday stops a working day, other days are unaffected, an overnight shift is nine hours not minus fifteen, a shift can add Saturday) and 18 API/UI checks (HR creates a shift and an employee cannot, duplicate names and impossible times are refused, assigning works and the count follows, holidays refuse a repeated date and everyone can read them, deleting a shift moves its person back, and the employee form offers "Company hours" plus the shifts).
- **Where:** `models/{Shift,Holiday}.ts`, `lib/time/company-clock.ts`, `lib/validation/scheduling.ts`, `services/{schedulingService,attendanceService,employeeService}.ts`, `app/api/{shifts,holidays}/**`, `components/scheduling/scheduling-view.tsx`, `components/employees/employee-sheet.tsx`, `app/(dashboard)/scheduling/page.tsx`, `lib/permissions.ts`, `config/navigation.ts`, `components/layout/sidebar.tsx`.

### A91. Leave plans, with balances and the same approval chain (owner request, 25 Sep 2026)
- **What:** `/leave` has the three tabs from the reference the owner sent - **History**, **Create**, **Balance**. Create takes a type, a start and end date, a note and an optional attachment; the six types are **PL, CL, SL, Comp Off, Loss of Pay and On Duty**. It goes to the **team lead, then the manager, then HR**, and History shows Pending, Approved or Rejected with the trail.
- **Before this, leave was only something an admin marked on someone's attendance.** There was no request, no approval and no balance.
- **The chain is literally the same code as swipes.** `buildChain`, `canDecide` and `approversFor` were pulled out of the swipe service into `services/approvalChain.ts` and both now use it - one place where "who approves, in what order, and who may never decide their own" is decided.
- **Days counted are working days,** computed once at submission against that person's shift and the company's holidays (A90). A plan spanning a weekend or Diwali does not quietly eat the balance.
- **Balance accrues monthly rather than being granted on 1 January:** in September you have earned nine twelfths of the year. HR sets days per year per type in **Shifts & holidays > Leave allowance**. Loss of Pay and On Duty carry no entitlement - they are recorded, never deducted.
- **Overdrawing is refused with the way out named:** asking for more than is left says how many days remain and points at Loss of Pay, rather than failing blankly.
- **Overlaps are refused** so the same days cannot be booked twice, and a pending plan can be **withdrawn** by the person who asked.
- **Verified:** 21 checks - HR sets an allowance and an employee cannot, the balance accrues to nine twelfths, applying counts working days only and starts pending with the right chain, overlapping and backwards ranges are refused, the employee cannot approve their own and the manager cannot jump the lead, the chain walks lead to manager to HR, an approved day comes off the balance, a rejection ends it, a pending plan can be withdrawn, all six types are offered, and History shows Approved and Rejected.
- **Where:** `models/{LeaveRequest,LeavePolicy}.ts`, `services/{leaveService,approvalChain,swipeService}.ts`, `lib/validation/leave.ts`, `app/api/leave/**`, `components/leave/{leave-view,leave-panels}.tsx`, `app/(dashboard)/leave/page.tsx`, `components/scheduling/scheduling-view.tsx`, `components/dashboard/tiles.tsx`, `config/navigation.ts`, `types/index.ts`.

### A92. An entrance on the sign-in screen, and where the sign-in delay actually goes (owner request, 25 Sep 2026)
- **The animation:** the sign-in panel slides in from the left and the card rises, and the button reads "Taking you in..." while the browser is on its way. Anyone whose system asks for reduced motion gets none of it.
- **It animates transform only, never opacity - and that was learned the hard way.** Two earlier versions used an opacity fade held by a fill mode (`both`, then `backwards`), and both left the **entire login screen blank**: the animation was throttled at its first frame in a mobile context, and the element simply stayed at `opacity: 0`. A transform stuck at its first frame is a card sixteen pixels low, which nobody notices; a hidden card is a broken product. Checked in four combinations - phone and desktop, reduced motion on and off.
- **Where the sign-in second and a half goes,** measured on the server rather than guessed: CSRF 6 ms, the credentials POST **552 ms**, `GET /` (which only resolves the session and redirects) **232 ms**, and the dashboard render **~500 ms**. Inside the POST, bcrypt alone is **291 ms**.
- **bcrypt is not a bug.** Cost 12 is the spec's minimum and it is deliberately expensive; `bcryptjs` is pure JavaScript, so it is slower than a native build would be. Lowering the cost would trade a fifth of a second for a weaker password hash, which is not a trade to make quietly.
- **An attempted optimisation was measured and reverted.** Asking the session endpoint for the role and jumping straight to that dashboard - skipping the `GET /` hop - was **not faster**: 1.7-2.2 s either way, the difference inside the noise. The hop happens inside a navigation the browser is already making, while the lookup is a serial round trip before it starts. The simpler code stayed.
- **What did improve:** `app/(dashboard)/loading.tsx` streams a skeleton while a page is built, so moving between pages shows the shape of what is coming instead of freezing. It does nothing for the first load after signing in - that is a fresh document, and the browser holds the old page until the HTML arrives.
- **Where:** `app/globals.css`, `app/(auth)/layout.tsx`, `components/auth/login-form.tsx`, `app/(dashboard)/loading.tsx`.

### A93. A real profile: personal details, photo and a reporting list (owner request, 25 Sep 2026)
- **What:** `/profile` now opens with who someone is - photo (changeable in place), name, role - then **Personal** (phone, gender, marital status, date of birth, address, emergency contact), **Employment** (company, designation, department, branch, team, reports to, joined), the **reporting list**, and then the menu from A89.
- **The split is deliberate: people own their personal details, HR owns their employment.** Somebody editing their own designation is not a feature, so those fields are read-only on this page and an employee instead writes one line under Edit - `updateRequest` - which HR sees. Enforced in the schema, not just the UI: a PATCH naming `designation` or `branch` is ignored, and the test proves an employee who tries to make themselves CEO stays a Coordinator.
- **The reporting list is a to-do, not a feed.** It shows only what has actually reached this person's step - pending swipes and leave plans, grouped by whose they are - so it empties as they work through it. An employee has none.
- **Dates of birth are stored at midday UTC.** A birthday is a calendar date; storing it at midnight lets a timezone shift it a day either way, which is how people end up wished a happy birthday on the wrong date.
- **Replacing a photo deletes the old object,** so a company's storage does not grow by one image every time somebody changes their picture.
- **Caught by the test:** the date-of-birth pattern reached the file as `/^d{4}-d{2}-d{2}$/` - the backslashes were eaten by a layer of shell quoting - so every save was rejected with a 422. It is now written as an explicit character class, which has no backslashes to lose. The other validation files were checked and are intact.
- **Verified:** 17 checks - HR sets branch, department and designation; an employee saves their own details and they read back; the date of birth does not slide a day; the emergency contact is stored; an employee cannot change their own designation; an employee has no reporting list; and the page shows personal, employment, the emergency contact, the update request, the photo control and the menu.
- **Where:** `models/User.ts`, `services/profileService.ts`, `lib/validation/company.ts`, `app/api/me/{route,profile,avatar}.ts`, `components/profile/profile-details.tsx`, `components/layout/profile-view.tsx`, `components/employees/employee-sheet.tsx`, `services/employeeService.ts`.

### A94. The attendance ledger (owner request, 25 Sep 2026)
- **What:** `/reports/ledger` shows one person, one month, day by day - what each day counted as (Present, Late, Half Day, Absent, Leave, Holiday, Week off, Upcoming, Before joining), the clock-in and clock-out, hours, and **whether the day earns pay**. A summary row across the top counts payable days, present, late, half days, absent, leave, loss of pay and hours.
- **One place decides what a day was worth.** Payroll will ask this service rather than counting again, so the ledger a person reads and the payslip they are paid from cannot disagree.
- **What is payable:** everything except Loss of Pay and an absence with nothing behind it. Holidays and week-offs are payable - nobody is docked for a Sunday. Days still to come are "Upcoming", not absences.
- **Caught by looking at the screen:** somebody who joined on the 25th showed twenty-four absences for the earlier part of the month. Days before a person's joining date are now "Before joining" and count towards nothing. A payslip built on the old numbers would have been badly wrong.
- **A scope bypass was found and fixed, and it was mine.** The check read `{ ...scopeFilter, _id: asked }`; for an employee the filter is `{ _id: me }`, so the spread overwrote it and the query became "does this user exist" - true for everyone. An employee could read anybody's ledger. It is now `$and: [scope, { _id: asked }]`, verified as a 403. The same spread appears in four other services, but all of them sit behind permissions an employee does not have - this route was reachable because it is guarded by `attendance:view`, which employees do have.
- **Verified:** 18 checks - the month loads in full, a holiday is named and still pays, approved leave is named and pays, Sunday is a week off and pays, today reflects the clock-in, future days are not absences, the summary counts payable days, an employee is refused someone else's ledger while HR is allowed, and the page renders with an employee picker.
- **Where:** `services/ledgerService.ts`, `app/api/reports/ledger/route.ts`, `components/reports/ledger-view.tsx`, `app/(dashboard)/reports/ledger/page.tsx`, `config/navigation.ts`.

### A95. A unique employee code for everybody (owner request, 25 Sep 2026)
- **What:** every person now carries a code - **EMP001, EMP002...** - shown on their profile beside the employment facts and editable by HR on the employee form. It is unique within a company.
- **The scheme is a setting, not a constant:** `employeeCodePrefix` (default `EMP`), `employeeCodePadding` (default 3) and the running counter live on the company, so `BRD0001` or `HYD001` needs no code change. Changing it affects the next code issued and never rewrites one already given out.
- **The counter is incremented atomically** with `findOneAndUpdate` + `$inc` on the company. The obvious alternative - count the users and add one - hands two people the same code whenever two are added at once, and reuses the code of anyone deleted.
- **HR can type a code instead,** for people who already have one from an old system. A clash is refused with a plain 409 rather than surfacing as a duplicate-key 500.
- **Unique per company, over codes that exist.** The index is partial (`employeeCode` is a string), so the super admin and anyone not yet assigned one do not all collide on null.
- **Anyone who predates codes can be given one** at `POST /api/employees/backfill-codes`, oldest first so the numbering follows the order people joined. Running it twice assigns nobody twice.
- **Verified:** 13 checks - someone without a code is given one and a second run assigns none, everybody has a code and all are unique and shaped `EMP001`, a new joiner takes the next unused code, a custom code can be set, the same code twice is refused with a 409, the prefix and padding can be changed and the next code follows the new scheme, and the profile shows it.
- **Where:** `models/{Company,User}.ts`, `services/{employeeCodeService,inviteService,employeeService,companyService,profileService}.ts`, `lib/validation/{employees,company}.ts`, `app/api/employees/backfill-codes/route.ts`, `components/employees/employee-sheet.tsx`, `components/profile/profile-details.tsx`.

### A96. A test suite: units for the maths, a browser for the rest (25 Sep 2026)
- **What:** `npm test` runs Vitest over `tests/unit` in about seven seconds and touches nothing; `npm run test:e2e` drives a real browser against a running server and a real database. `tests/README.md` explains both.
- **The end-to-end run builds its own company and deletes it again** through the Super Admin API - an admin, HR, a manager, a team lead and an employee in a team under both, which is the shape the approval chain needs. Teardown is in a `finally`, so a suite that throws halfway does not leave a company behind; `E2E_KEEP_LAB=1` keeps one when you want to look at what a run produced.
- **Sessions are pooled, because sign-in is rate limited.** Ten attempts a minute per IP, and a whole run shares one IP. Signing five people in per suite tripped the limit around the third suite, and the failure read like a wrong password. Each person now signs in once for the run.
- **Suites wait for text, not for a guessed number of seconds.** A dev server compiles a route the first time it is asked for, which outruns any sleep worth writing.
- **Caught by writing the tests:** the dev CSP had no `'unsafe-eval'`, which `next dev` needs for hot reloading, so **nothing hydrated in development at all**. The login form fell back to a native submit - and with no `method` on the form that is a GET, which put `?email=...&password=...` in the address bar. Both fixed: `'unsafe-eval'` in development only (production still blocks it, verified across `NODE_ENV` unset/development/production), and `method="post"` on all four auth forms so a script failure can never put a password in a URL, a history entry or an access log.
- **Also caught:** `relativeTime` reads the clock, and it was called from `"use client"` components that also render on the server, so any value near a minute boundary was a hydration error. It is now a `<RelativeTime>` component that renders `<time dateTime>` with `suppressHydrationWarning`, corrects itself on mount and ticks every thirty seconds - so the timestamps are live rather than frozen at whatever the server said.
- **Verified:** 69 unit checks and 8 browser suites. The permission and scope tests were each confirmed to fail when the thing they protect is removed - a test that cannot fail is decoration.
- **Where:** `vitest.config.ts`, `tests/**`, `next.config.ts`, `components/auth/*-form.tsx`, `components/ui/relative-time.tsx`, and the twelve components that used to call `relativeTime` directly.

### A97. Security review: injection, scope and the two shells (owner request, 26 Sep 2026)
A pass over the whole surface - web and both packaged apps - looking for injection, for data reachable by people who should not reach it, and for anything a hostile input could talk the server into. What follows is what was found, what was changed, and what was deliberately not.

**The serious one: a people-scope filter that a spread erased.**
- `employeeScopeFilter` answers "which people may this caller see". For an employee it returned `{ _id: me }`, and callers all over the codebase ask about one person by writing `{ ...scope, _id: askedFor }`. That spread **replaced** the restriction instead of adding to it, so the query stopped restricting anything.
- Reachable as an ordinary employee, by adding `?userId=` to a request: **attendance, the leave history, the leave balance, breaks, the full profile - date of birth, home address, phone, emergency contact - and swipes, which carry a face photograph and a GPS fix.** Each of those was a different one of the same mistake.
- Two further sites were latent rather than reachable: `getEmployee` and the live status board, both of which a **team lead who has not yet been given a team** could have used to read the whole company, because a teamless team lead falls to the same `{ _id: me }`.
- **Fixed at the source:** every restriction is now returned inside `$and`, where a sibling `_id` is an extra condition rather than a replacement. That defuses the pattern for every caller, including ones not written yet.
- **And explicitly at each entry point:** `requireVisibleEmployee(ctx, userId)` checks the person is in scope and answers **403** rather than returning an empty list - an empty list is indistinguishable from "no records", which is how this went unnoticed.
- **Three routes were checking the wrong thing entirely:** the leave balance, the profile and the breaks endpoints asked `role !== "EMPLOYEE"` as a stand-in for "may see this person". That is not the same question - it let a team lead read anyone in the company - and they now use the scope.

**Regex injection and a denial of service in four search boxes.** `q` went into `$regex` unescaped in the client, employee, project and task lists. `(a+)+$` there is catastrophic backtracking - one authenticated user pinning a CPU - and the metacharacters let someone probe for data they cannot read. The project already had `escapeRegex`; it is now used in all seven places, with the two hand-rolled copies replaced by it.

**Mail headers.** Invitation subjects interpolate a company name and a person's name, both typed by users, and a carriage return in either would end the Subject header and start another - a `Bcc`, say. `sendMail` now folds those to spaces, and accepts only a single plain ASCII address: no display name, no angle brackets, no list, no RFC 5322 comment, no non-ASCII. That also closes the recipient-domain bypasses and the address-parser denial of service in the nodemailer advisories **regardless of the installed version**, because the parser never sees anything interesting.

**The Android app.** `allowBackup` was on, which is the default - and a backup of this app's private data is a copy of the WebView cookie store, which is a copy of whoever was signed in. It is off now, with `dataExtractionRules` refusing cloud backup and device-to-device transfer as well. A network security config states no cleartext and trusts only the system certificate store, so a certificate pushed onto the device cannot be used to read the session traffic.

**Checked and already correct** - worth recording so the next pass does not redo it: no `dangerouslySetInnerHTML` anywhere; uploads are a MIME allowlist plus magic-byte sniffing with no SVG accepted; sign-in parses credentials through Zod before the query, so a Mongo operator in place of an email is a 422 and not a login; `updateEmployee` assigns field by field with role-escalation guards and invalidates sessions on a role change; the billing webhook is an HMAC over the raw body compared with `timingSafeEqual`, with replay protection on the payment id; invite tokens are stored as hashes; no CORS header is set anywhere, so every API route is same-origin only; and all 104 API routes carry a guard except the seven that are public by design. Electron runs with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, a preload that exposes three inert strings, and navigation locked to the app's own origin.

**Not fixed, and why.**
- **The rate limiter counts per instance, not per deployment.** It keeps its counters in process memory, which was accurate for the single VPS it was written for. This app runs on Vercel, where requests are spread over however many instances are warm and each keeps its own count - so "ten sign-ins a minute" is ten *per instance*, and resets when one is recycled. It is a speed bump against credential stuffing, not a gate. Making it real needs a shared store; Upstash Redis is the usual answer on Vercel and only `lib/rate-limit.ts` would change. The docstring now says this instead of implying otherwise.
- **`npm audit` still reports nodemailer.** Fixing it needs nodemailer 10, whose optional peer range next-auth and `@auth/core` both cap at 8. Overriding that de-hoisted `@auth/core` out of the top level, which silently broke the `declare module "@auth/core/jwt"` augmentation and turned `token.ctx` into `{}` - caught by the typecheck. The advisories that our usage can actually reach are the recipient-domain bypasses and the parser denial of service, and both are closed by the address rule above, at our own boundary, where it keeps working whatever the dependency does.
- **postcss (via next) and uuid (via exceljs and imagekit)** need major upgrades of Next and ImageKit. postcss runs at build time on our own CSS, and the uuid issue needs a `buf` argument this codebase never passes. Both are worth doing on their own schedule, not as part of a security pass.
- **vitest** is left on 3.x: the fix is vitest 5, which requires vite 8 and esbuild 0.28, and esbuild bundles the production server. Trading the production build pipeline for a dev-only advisory in a mocker feature these tests do not use is the wrong way round.

**Verified:** a new `access-control` browser suite makes each of these requests as a real employee and requires a 403, checks the same requests still work for HR and for the employee's own records, confirms a regex bomb in a search box answers promptly, and confirms a Mongo operator in place of an email signs nobody in. A new unit suite pins the *shape* of the scope filter - not just its behaviour - because the shape is what keeps future callers safe; both it and the email rules were confirmed to fail when the protection is removed.

### A98. Grouped entries, and daily reports you can download (owner request, 26 Sep 2026)
- **The time report's Entries table is one line per person per day.** A busy day was a dozen rows of the same name and no answer to "how long did this person work", which is the question the table is usually open for. The line carries the day's total, the number of sessions and how many clients they were spread across; opening it shows the sessions with their own client, task, start, end and duration.
- **Grouped by person *and* day, not by person alone,** so the Date column keeps meaning something over a range.
- **The flat list stays, on a toggle.** It is what the timesheet shows and what the export contains - the card used to say "identical to the timesheet", and hiding it would have made that quietly untrue.
- **Daily reports download as CSV, Excel and PDF.** `/api/reports/daily` returned JSON only; it now takes `?format=` like every other report and goes through the same `exportTable` helper. The export includes **the people who did not submit**, because a missing report is usually what is being looked for - dropping those rows would make the file answer a different question from the screen.
- **Newlines inside a report are folded to spaces.** A raw newline in a CSV cell ends the row for most importers, and the export exists to be opened elsewhere.
- **The download follows the filters and the permission scope**: an employee's file only ever contains their own row, which the test asserts rather than assumes.
- **The CSV/Excel/PDF buttons are one component now** (`components/reports/export-buttons.tsx`), lifted out of `ReportShell` so the daily view gets identical behaviour - fetch with the session cookie, the server's filename, and an error as a message instead of a downloaded file full of JSON.
- **Verified:** 34 browser checks - the grouped line and its total, opening and closing it, the toggle, and each format downloading as a real file (an .xlsx that is genuinely a zip, a PDF that starts `%PDF`).
- **Where:** `components/reports/{entries-table,export-buttons,report-views,daily-views}.tsx`, `app/api/reports/daily/route.ts`, `services/reportService.ts`, `lib/validation/reports.ts`.

### A99. The employee report carries what people wrote (owner request, 26 Sep 2026)
- **What:** the Employee report download now has a second table, **Submissions** - one line per person per day with the daily report they submitted, the notes they typed against the clock, and the hours for that day. In Excel it is its own sheet; in CSV it follows the summary under its own heading; in PDF it is its own page.
- **Why it is a separate table rather than more columns.** The summary is a row of counts per person over a range - it can say "12 of 14 reports submitted" but not what was in them. Prose does not fit on that row, and **truncated prose is worse than none**, because it reads as though that is all the person wrote.
- **"What they submitted" is taken to mean both** the daily report and the notes on the time entries. Both are things the person typed, both were being asked for, and they are labelled separately so it is clear which is which.
- **`employeeReport` now fetches the daily reports instead of aggregating them to a count** and counts them afterwards - the same query, more of the answer.
- **PDF columns declared 40 wide or more now wrap and grow the row** instead of ellipsing. A daily report cut off at the column edge is a misleading document, not a tidy one.
- **Verified:** 11 unit checks on the export library - that a comma inside a value is quoted (unquoted, every column after it shifts by one, silently), that a quote is doubled, that Excel really gets two sheets named `Employee report` and `Submissions`, and that the section's prose arrives intact - plus browser checks that the download contains what the person actually wrote.
- **Where:** `lib/export/index.ts` (the new `sections`), `services/reportService.ts`, `tests/unit/export.test.ts`.

### A100. Attendance as a calendar, a list, and a day you can open (owner request, 26 Sep 2026)
Built from three screenshots of another app: a month calendar of status chips, a per-day list, and a sheet that opens when a day is tapped showing the swipe photos and where they were taken. All three live on `/reports/ledger`, which already held the data.

- **Calendar.** The month as a grid, Monday first, each day carrying a code - **P, LT, HD, A, L, H, WO** - coloured the same way the rest of the app colours those states, with a legend underneath spelling each one out. Monday first because the working week starts on Monday here, and a calendar that disagrees with the roster is misread at a glance.
- **List.** One card per day: the status, in and out, **late in** and **early out**, hours worked, and how many swipes there were.
- **Late in and early out are computed against the shift the person is actually on,** not against the company default, and only where both ends exist - a day with no clock-out is unfinished, not early. The overnight case is handled explicitly: a shift ending at 07:00 ends *the next day*, so comparing raw clock times would make every night worker hours early every night.
- **Opening a day** shows each swipe: the photo, the time, on or off duty, the place, how far it was from the nearest site, what accuracy the phone claimed, any note, and **View on map**.
- **The map is a link, not an embed.** An embedded map would load a third-party script into a page showing an employee's location; a link opens one only when somebody chooses to.
- **The swipe counts come from an aggregate, one query for the month.** The photos and coordinates are fetched for the single day somebody opens - loading thirty-one days of signed photo URLs to render a calendar would be absurd.

**The one thing not built: the street address.** The reference shows a reverse-geocoded address under each photo. A swipe stores coordinates, the site name and the distance - not an address - and turning coordinates into a street address needs a geocoding provider (Google, Mapbox, Nominatim), which means an API key, a per-lookup cost, and **sending employee locations to a third party**. That is a decision to be taken rather than assumed, so the sheet shows the site name and the coordinates instead, and the map link covers the "where was this" question. If it is wanted, the place to do it is at swipe time - geocode once and store it - not on every read.

- **Verified:** the ledger suite now checks the calendar draws a cell per day and spells out its codes, that the list shows in/out/late-in/early-out, and that opening a day shows the photo, the time, the place and a map link pointing at the recorded coordinates.
- **Where:** `services/ledgerService.ts`, `components/reports/{ledger-view,day-swipes-sheet}.tsx`.

### A101. One phone at a time (owner request, 26 Sep 2026)
- **What:** a person can be signed in on **one phone**. Signing in on a second phone ends the first phone's session; the first phone discovers this on its very next request and lands on the login screen with a line telling it what happened. Desktops and browsers are untouched.
- **Newest sign-in wins, rather than blocking the new device.** The owner was offered the stricter rule they first described - refuse the new phone until the old one signs out - and chose this. It is the right choice, and the reason is worth recording: with the strict rule the *only* way to release the lock is to sign out on the old phone, so a phone that is lost, stolen, broken, wiped or reinstalled locks somebody out of their own account **for up to thirty days**, including out of clocking in, which is how they get paid. Newest-wins has no state a dead phone can leave behind.
- **A phone competes only with phones.** A tablet and the desktop app count as desktops: the thing being prevented is one login being passed around so a colleague can swipe attendance, and stopping HR from having the desktop app open while their phone is in their pocket would be friction for no benefit.
- **Ended sessions are marked, not deleted.** `revokedAt` and `revokedReason` are set instead, so the login screen can say *"You were signed out because this account was used on Chrome on Android 4 minutes ago"* rather than dropping somebody at a sign-in box with no explanation - which reads as the app being broken and becomes a support ticket. `resolveSession` refuses a revoked row from that moment on, and the existing TTL index clears the rows out in time.
- **The device is read from the user agent, which is a workflow control and not a security boundary.** A user agent is sent by the client and can claim anything, so somebody determined could present as a desktop and hold a second session. Making it tamper-resistant needs an id from the native layer rather than a header - `@capacitor/device`, stored and compared - which is a further piece of work. What this does do is stop the casual case, which is the one that actually happens.
- **The classifier is tested against real user agents, not invented ones**, because the real ones lie about each other: Edge and Opera both claim to be Chrome, Chrome claims to be Safari, and the Electron shell claims to be Chrome on the host platform. Reading the desktop app as a phone would mean every HR person signing in on their laptop silently kicked themselves off their own phone.
- **Verified:** 15 unit checks on the classifier and 15 browser checks - a phone and a desktop signed in together, a second phone taking over while the desktop is untouched, the old phone landing on the login screen and being told which device took over, signing in again always working, and another person's phone unaffected.
- **Where:** `lib/auth/device.ts`, `lib/auth/session-service.ts`, `models/Session.ts`, `app/(auth)/login/page.tsx`.

### A102. The payroll month, and payslips people can check (owner request, 26 Sep 2026)
The first piece of payroll: the cycle everything else will hang off, and a way to put a payslip in front of the person it belongs to.

**The 26th-to-25th cycle.** `payrollStartDay` on the company (1 = calendar month, 26 = the 26th to the 25th) drives one helper, `lib/time/payroll-period.ts`, and **the attendance ledger now follows it too**. That second part is the point: an absence counted in one month while the deduction for it lands in another is exactly how a payslip and an attendance record come to disagree, and there is no arguing your way out of it afterwards.
- A period is **named after the month it ends in** - "September" on a 26th cycle means 26 August to 25 September, which is the payslip somebody expects to receive in September.
- **A period ends the day before the next opens, and starts the day after the last one closed.** Deriving both ends from one rule is what makes gaps and overlaps impossible. It matters at the edges: on a 31st cycle February closes on the 28th, and March starts on the 1st. Computing March's start independently as "the 31st of February, clamped" would have given the 28th to *both* months - one day of somebody's pay, counted twice. **A test caught exactly that**, which is why the test asserts the property (every day of the year in exactly one period, no gaps) rather than a handful of examples.

**Payslips.** HR uploads a PDF per person per month; the employee sees their own at `/my/payslips` with the days it covers, and downloads it.
- **The register lists the people who have *no* payslip too.** On the 30th the question is never "show me what I uploaded", it is "who have I still not done" - and a list of only the uploaded ones cannot answer it.
- **Each payslip records the days it covered, rather than recomputing them.** A company that changes its cycle next year must not silently rewrite what an already-issued payslip claimed to pay for.
- **One row per person per month**, enforced by a unique index. Uploading again replaces, deletes the file it replaced, and is written to the audit log - a payslip that changed after somebody read it has to be explainable.
- **Files are private, links expire in five minutes,** and the type is checked by magic bytes, not by what the upload claims. Your own payslip always; anybody else's only with the grant, which is HR and the company admin.
- **Reading your own needs no permission grant**, like your own profile - a grant would have meant "everybody's".
- **Caught by the tenant guard, working as designed:** deleting through `doc.deleteOne()` carries no companyId filter and was refused. It goes through the scoped query now.
- **Verified:** 25 unit checks on the period maths and 32 browser checks - the cycle, the ledger agreeing with it, uploading, replacing, non-PDFs refused, an employee seeing only their own and being refused somebody else's, both screens, and deleting.
- **Where:** `lib/time/payroll-period.ts`, `models/{Payslip,Company}.ts`, `services/{payslipService,ledgerService,companyService}.ts`, `app/api/payslips/**`, `components/payroll/*`, `config/navigation.ts`.

**Still to come, in order:** salary structures (effective-dated, so a raise in June does not rewrite May), the monthly run computing from the ledger, statutory deductions as data rather than code, and payment - a bank advice file first, a payout API only after.

### A103. Payslips worked out, not uploaded (owner request, 26 Sep 2026)
The owner sent a real April 2026 payslip and asked for it to be generated rather than uploaded. It now is, and **the maths is pinned against that slip line by line** - if those numbers change, somebody's pay changed, and it should be deliberate.

- **Salaries are effective-dated.** A raise is a *new* row with a later `effectiveFrom`, never an edit: a payslip must be reproducible years later exactly as issued, and a June raise must not rewrite what May said. Every run asks which scale was in force on the day the period *ended*. The test proves it: a raise dated next year leaves this month at 33,000.
- **The figures come from three places that have to agree** - the scale in force, the attendance ledger for the same days, and the company's statutory rules. The ledger is *asked*, never recounted, which is what `payableDays` was built for back in A94.
- **EPF is twelve per cent of basic capped at a wage of 15,000** - which is why a basic of 16,500 deducts 1,800 and not 1,980. That one line is the most commonly got wrong, and it has a test of its own from both sides of the ceiling.
- **ESI is judged on the full monthly gross, not on a short month.** Otherwise a month of unpaid leave would pull somebody into ESI who is not eligible, and back out again the next month.
- **Professional tax is flat and does not prorate**, because the state charges it by the month rather than by the day.
- **The total is the sum of the rounded lines, not the rounded total.** They differ by a rupee often enough, and a payslip whose column does not add up is the first thing anybody notices. Tested across eight different attendance splits.
- **Net is never negative.** A deduction bigger than the earnings is a data problem, and a payslip promising a negative payment helps nobody.
- **Statutory rates are company settings, not constants.** They are set by law and they change; a rate written into a source file is wrong from the day the budget changes, and silently. The defaults are the Indian ones - confirm them with an accountant before anybody is paid from them.

**The hazard this turned up, and what was done about it.** Days that have not happened yet are not payable days, so **running payroll before the period ends prorates everybody down to the days so far** - a fortnight in, everyone is paid half. The figures are correct and the payslip looks completely normal, which is what makes it dangerous. The run now says so, in the response and as a warning on screen, and says the same when somebody joined part way through the period.

- **Uploading is still there** for a month worked out elsewhere; generating is simply the default now.
- **What HR types in survives a regenerate** - TDS, a late penalty, an advance, arrears - so re-running after fixing an attendance record does not quietly drop them.
- **The whole-company run reports who was skipped and why**, rather than counting the successes and leaving the rest unmentioned.
- **The PDF is matched to the slip the company already issues**, deliberately rather than redesigned: people have read that layout for years and know where their net pay is. The one addition is a "Pay period" line, so a 26th-to-25th month is not a mystery.
- **Verified:** 33 unit checks on the maths, including the April slip reproduced exactly, and 36 browser checks end to end - salary set, payslip generated, a real PDF out of storage, adjustments surviving a regenerate, a future raise leaving an issued payslip alone, and an employee refused both the register and somebody else's slip.
- **Where:** `lib/payroll/{compute,payslip-pdf}.ts`, `models/{SalaryStructure,Payslip,User,Company}.ts`, `services/payrollService.ts`, `app/api/payroll/**`, `components/payroll/*`.

**Not built yet:** TDS is typed in rather than computed across the year, gratuity and bonus are absent, and nothing pays anybody - a bank advice file comes before any payout API.

### A104. The order things are approved in, set by the admin (owner request, 26 Sep 2026)
The chain was fixed in code - team lead, then manager, then HR. The owner asked to be able to set that sequence, so it is now a company setting: `approvalChain` on the company, drag the three steps into the order this company uses, and **leave and off-site swipes both follow it**, because one chain is the point.

- **HR is always last, whatever order is chosen.** Not a UI nicety - a chain that ends anywhere else has a request settled by somebody who cannot see the whole picture, and HR then finds out afterwards. The editor lets the first two move and pins the last.
- **A step is skipped when there is nobody distinct to fill it.** A team lead does not approve their own leave; somebody with no manager does not wait forever for one. This was already true and stays true under reordering - the alternative is requests stranded with nobody able to decide them.
- **Removing a step does not touch requests already in flight.** The chain a request was created under is the chain it is judged by, so changing the setting on the 15th does not silently re-open or auto-approve anything pending.
- **Where:** `models/Company.ts`, `services/approvalChain.ts`, `components/settings/approval-chain-editor.tsx`.

### A105. A picture of the work, not just a description (owner request, 26 Sep 2026)
The owner asked that stopping the timer and filing a daily report both require a description **and** a photograph. Both now do, controlled per company by `workProof.timer` and `workProof.dailyReport`, **on by default** - the setting arrived switched on and a company that predates it should get the behaviour that was asked for, not the opposite.

- **`capture="environment"` on the input**, so a phone opens the camera rather than the photo library. A laptop ignores it and shows a file picker, so one control serves both.
- **The hazard this turned up: force-switching timers closed the running one without ever asking for a picture.** Starting a second job while one was running was a legitimate shortcut that quietly became the way around the requirement. It is refused now - stop the first one properly.
- **And a second: editing a daily report checked whether a picture was *required* but not whether one was *already there*,** so the JSON edit path refused every edit of a report that already had its photo. A test caught it.
- **Screenshots are stored privately and read through links that expire.** A picture of somebody's work carries a client's name, an inbox, sometimes a face.
- **Where:** `lib/storage/work-proof.ts`, `components/ui/proof-field.tsx`, `app/api/timer/stop/route.ts`, `app/api/daily-reports/route.ts`.

### A106. The phone home leads with today's swipes, not the timer (owner request, 26 Sep 2026)
The timer came off the phone's home screen and today's swipes took its place. The timer still exists on `/timer`; what changed is what the screen opens with. The owner's reasoning holds up: on a phone the first question is *did my attendance register*, and a timer at the top of the screen answered a question most people were not asking.

- **Each swipe as a row - on or off duty, the time, the place** - and nothing when there are none, rather than an empty card with a heading.
- **Where:** `components/dashboard/{mobile-home,today-swipes}.tsx`.

### A107. The employee code on the home screen (owner request, 27 Sep 2026)
Every employee already had a unique code (A99). It is now on the phone's home screen, under their name, because the code's whole purpose is to be read out - to HR, on a form, over the phone - and hunting for it in a profile screen defeated that.

- **Where:** `components/dashboard/mobile-home.tsx`, `types/index.ts`.

### A108. Checking the face on a swipe, on the device (owner request, 27 Sep 2026)
The owner asked whether attendance could verify the face in the swipe photo, refuse a mismatch with a retake, and work from a shared device at a door. It does, and the brief they chose was **on-device** - so there is no per-call cost and no face leaving the phone.

**How it works.** `@vladmandic/face-api` runs in the browser, finds the face, and turns it into **128 numbers** - a descriptor. Enrolment averages several captures into one. A swipe sends the descriptor alongside the photo, and the server compares it to the enrolled one: a euclidean distance below the threshold is the same person.

- **The phone sends the descriptor. The server decides.** Never the other way round. A client that reports its own verdict is a client that can report "matched" for anyone, and attendance is exactly the thing somebody has a motive to fake.
- **The threshold is a company setting, default 0.6** - the value face-api documents. It is a trade, and it belongs to whoever has to live with it: lower rejects somebody who grew a beard, higher accepts their brother.
- **Failing to read a face is not failing to swipe.** No face found, bad light, a phone that could not load the models: the swipe is recorded as `unverified` and flagged for somebody to look at. A camera in a dark stairwell must not be able to stop somebody being paid - and the photograph is there for a human to check.
- **A mismatch asks for a retake, up to `maxRetries` (default 3), and then records it for review** rather than refusing forever. Same reasoning.
- **The distance is stored on the swipe**, so a decision can be explained months later instead of being an unarguable verdict.
- **Off by default, and that order matters:** switch the check on before people have enrolled and nobody can swipe. Enrol first. There is a register showing HR who has and has not.
- **A face can be removed, by its owner, always.** It is their data.
- **The cost is 6.5 MB of model weights**, served from `public/models` and downloaded only when the company has the check switched on - nobody pays for that to record a swipe that is not going to be checked.
- **Not built: liveness.** Nothing here can tell a face from a photograph of a face held up to the camera. Doing it properly means a challenge - blink, turn your head - and it is the obvious next piece if this is used at an unattended door. Said plainly because the feature reads as more secure than it is.
- **Verified:** unit checks on the descriptor maths (distance, averaging, the threshold either side, malformed input) and 30 browser checks - enrolling, the register, a swipe carrying a descriptor, a mismatch asking for a retake, the models loading under the production CSP, and the check being off until switched on.
- **Where:** `lib/face/{match,client}.ts`, `services/faceService.ts`, `components/attendance/face-enrolment.tsx`, `app/api/face/**`, `app/api/me/face/**`, `models/{User,Company,AttendanceSwipe}.ts`.

### A109. Pictures stored in kilobytes, not megabytes (owner request, 27 Sep 2026)
The owner asked how uploads could be compressed so raw photographs do not fill the storage. An audit found **only swipe photos were compressed** - the other six paths stored whatever arrived, including the work-proof pictures added in A105. A phone camera produces four or five megabytes; an avatar shown at forty pixels was stored at four thousand.

**Two passes, because they solve different problems.**

- **In the browser, before the upload** (`lib/images/shrink.ts`). This is not about the storage bill, it is about the upload: on a site with one bar of signal, five megabytes is the difference between a swipe that completes and one that times out. The phone sends about two hundred kilobytes instead.
- **On the server, before storing** (`lib/storage/compress.ts`), on every path. The browser pass cannot be trusted to have happened - an old browser, a codec the canvas will not read, or a request that never came from the app at all.

**The sizes, by where the picture is actually shown** rather than one global number: avatar 512px, work proof 1280px, chat and task and leave attachments 1920px, a logo 512px and still a PNG so its transparency survives. A 12 megapixel photo becomes 60 KB, 200 KB and 400 KB respectively. For fifty people taking two proof photos a day that is roughly eleven gigabytes a month down to four hundred megabytes.

**Two things fall out of this that are worth having on their own.**
- **EXIF is dropped.** A photograph from a phone carries the coordinates it was taken at, and a chat attachment was quietly telling everybody in the channel where somebody lives.
- **Orientation is applied first.** `rotate()` before the metadata goes, or every portrait photo from a phone is stored on its side with the flag that explained why now missing.

**The hazards, and what was done about them.**
- **Re-encoding can make a small image bigger** - an 8px PNG icon becomes a larger JPEG. Both passes keep the original when that happens. The first version of the check compared the output width against the *target* rather than the *input*, which called every image under 1920px "resized" so the guard never fired; it stored files three times the size they arrived at. A test caught it, which is why the test asserts bytes rather than intent.
- **The extension and the MIME type have to agree** or the server refuses the upload as an unsupported type. A PNG re-encoded as a JPEG is renamed to `.jpg`. Getting this wrong fails the upload while telling the person their file type is unsupported, which it is not.
- **The storage quota was charging the raw size.** Usage is measured from what is stored so it self-corrects, but the pre-check would have refused a 5 MB photo that ends up taking 300 KB. It now asks "already full?" up front and charges for what actually landed.
- **Nothing may break an upload.** Every failure path returns the original file: a file sharp cannot read has already passed the magic-byte check, and an upload that fails because of the optimiser is worse than one that is a little large. A GIF is left alone entirely rather than losing its animation to a canvas.
- **The original is not kept, deliberately.** Keeping both is how a storage bill grows quietly, and nothing here wants the raw file.
- **Verified:** 44 unit checks - real images made by sharp rather than fixtures, since the point of the exercise is a number of kilobytes - plus the full browser suite passing with compression active on every path.
- **Where:** `lib/storage/compress.ts`, `lib/images/shrink.ts`, and the seven pickers and six upload paths they are wired into.

**Still worth doing:** `payrollStartDay` has no settings screen, CI does not run the tests, and the rate limiter is in-process so it resets on every Vercel cold start.

### A110. The founding admin had no employee code (bug, 27 Sep 2026)
The code badge added to the phone's home screen in A107 was blank for the owner. The markup was right; the account had no code.

- **Codes were assigned in two places, and the founding admin went through neither.** Everyone invited or added gets one; the company's first `COMPANY_ADMIN` is created by `createCompany` and was not. So the one person most likely to be asked to read their number out did not have one, and their payslip printed "-" in the ID field.
- **The backfill endpoint that would have fixed it had never had a caller.** Written in A95, no button, no UI, unreachable except by hand. It is on the Employees page now, offered only while somebody is actually missing a code.
- **Why the tests passed while this was live:** the employee-codes suite ran the backfill as its *first* action, so every later check looked at a company where codes had already been quietly repaired. A check now runs before it, and it was confirmed to fail on the unfixed build - 13/14 - rather than assumed to.
- **Existing companies need the button pressed once.** Assigning codes writes a permanent identifier that then appears on payslips, and the app offers no way to take one back, so it is a decision rather than a migration that runs itself.
- **Where:** `services/superAdminService.ts`, `components/employees/employees-view.tsx`, `tests/e2e/suites/employee-codes.mjs`.

### A111. Codes assign themselves (owner request, 27 Sep 2026)
A110 fixed new companies and put the backfill behind a button. The owner's own home screen was still blank, and they asked for it to be automatic rather than something somebody has to press.

- **A code is minted when the session is resolved**, so an account that predates codes picks one up the next time its owner opens the app. This is the only thing that ever repairs an existing company: the people missing codes are by definition the ones nobody has touched since codes were introduced, so waiting for an edit waits forever, and a button waits for somebody to remember it.
- **It costs nothing once done.** Somebody who already has a code is a field check on a document already in hand - no query. It runs once per person, ever.
- **The write is conditional on the code still being absent**, so two requests arriving together cannot hand one person two numbers: the second matches nothing and reads back what the first wrote. A number burnt from the counter leaves a gap in the sequence, which is harmless - two people sharing a code, or somebody's code changing after it has appeared on a payslip, is not.
- **It never throws.** A code is a convenience; failing to mint one must not be able to stop somebody signing in.
- **The button stays**, for assigning the whole company at once rather than person by person as they next sign in.
- **Verified:** the code is cleared through the API and then simply used - no repair call, because the point is that there is nothing to call - and it comes back, different from everybody else's. 17 checks in the suite now.
- **Where:** `services/employeeCodeService.ts`, `lib/auth/session-service.ts`.

### A112. The profile photo on the home screen (owner request, 27 Sep 2026)
The owner said their profile was not coming through on the home screen. It was not: the avatar was drawn as initials in a circle, unconditionally, and the screen never looked at `avatarUrl` at all. Uploading a photo worked and had always worked - the only screen that greets you by name simply did not ask for it.

- **The photo is laid over the initials rather than shown instead of them**, so a link that will not load uncovers the letters rather than leaving an empty circle or a torn-image icon. Avatar links are signed and expire, so this is a real state and not a theoretical one.
- **The test asserts the browser decoded a picture, not that an `<img>` exists.** The first version checked the tag was in the DOM and passed against a screenshot showing an empty circle - a tag whose `src` 404s is still a tag and still matches a selector. `naturalWidth > 0` is the only thing that says a picture actually arrived. A stale signed link is exactly how this breaks in the field, and the weaker check would have called it fine.
- **The screenshot was looked at, which is what caught the weak assertion.** The test image was also a brown almost identical to the header behind it, so a rendered photo and a missing one looked the same; it is a colour nothing else in the app uses now.
- **Where:** `components/dashboard/mobile-home.tsx`, `tests/e2e/suites/profile.mjs`.

### A113. The face model looked broken because it was only slow (owner report, 28 Sep 2026)
The owner said face verification "was not capturing, taking loading only". It was downloading. The weights are 6.5 MB and on mobile data that is a minute or more - but the screen showed one unchanging line for all of it, so a slow download and a broken one were indistinguishable. Four separate faults, only one of which was about speed.

- **No progress.** `loadFromUri` reports none, so the hint never moved. The bytes are now fetched first and counted as they arrive, and `loadFromUri` reads them out of the HTTP cache afterwards. Measured on a throttled connection: 0% to 99% over 79 seconds, which is a wait somebody will sit through rather than a screen they close.
- **No timeout.** A stalled download on a phone never rejects - the promise simply stays pending and the screen waits for ever. It gives up out loud after two minutes now.
- **A failed load was remembered.** `modelsPromise ??=` caches a *rejected* promise, so pressing the button again handed back the same failure without attempting anything; only a full page reload cleared it. Both cached promises are dropped on failure now.
- **The error blamed the camera.** One `catch` covered both the model download and `getUserMedia`, so a connection that dropped told somebody to check their camera - sending them to fix the wrong thing. `FaceModelError` separates them.
- **The weights are cached for a year, immutable.** They were served `max-age=0, must-revalidate`, so every launch paid a round trip per file before using bytes it already had. A new model would be a new file name.
- **Verified in a real browser with the network cut**, because none of this is reachable from an HTTP call: the failure is reported, it does not mention the camera, and trying again after it really does try again. 34 checks in the face suite now.
- **What this was not:** a 404. Chasing one locally led to a dead end - a different project was occupying port 3000 and answering every request, so the model files appeared to be missing. Production had been serving them correctly the whole time.
- **Where:** `lib/face/client.ts`, `components/attendance/face-enrolment.tsx`, `next.config.ts`, `tests/e2e/suites/face-check.mjs`.

### A114. The ledger tests ran out of month (test fix, 28 Sep 2026)
Three ledger checks failed overnight with nothing having changed in the ledger. The date had moved from the 27th to the 28th, and that was the whole story.

- **The suite spends the days it needs.** `futureWeekdays()` returns what is left of the month; the first becomes a test holiday and the second a test leave day. On Monday the 28th there were exactly two - the 29th and the 30th - so both were consumed and nothing remained to assert as "Upcoming". The existing guard asked for at least two, which is the precise number at which the last check starves.
- **And the calendar took the other one.** The check wanted a Sunday on or after the join date, but the test's employee is created today and the month's last Sunday was the 27th.
- **Both now read from next month**, which is wholly in the future and always contains Sundays. The assertions are unchanged in what they claim; they simply no longer depend on how much of this month happens to be left.
- **Worth saying plainly:** these would have failed on the 28th of any month with this shape, and the suite has been green every day until the one it was run on. A test that passes because of the date is a test that is not being run.
- **Where:** `tests/e2e/suites/ledger.mjs`.

### A115. Capture spun for ever, with the camera already open (owner report, 28 Sep 2026)
A113 fixed the download. The owner then sent a photograph of the screen that showed what was actually wrong: the camera was live, the model was loaded, "0 of 4 captured" - and the **Capture** button was spinning. The download had never been the problem at that stage; the face read itself never came back.

- **`await readFace(...)` never settled**, so `setBusy(false)` never ran. On iOS every browser is WebKit, and tf.js on WebKit's WebGL can stop inside an inference - not slowly, not with an error, simply never resolving. The only way out was killing the app.
- **Every read now has twenty seconds.** Far longer than the half-second it takes when the GPU path works, short enough that somebody holding a phone to their face gets an answer. The button resets in a `finally`, so it cannot be left spinning whatever happens underneath.
- **The model is warmed up during setup.** The first inference on a device compiles shaders and uploads weights - twenty seconds on a phone against half a second for every run after. That is now paid while the screen says it is getting ready and the person knows they are waiting, rather than on the one tap that matters. This is the most likely cause of what was reported.
- **`'wasm-unsafe-eval'` added to the CSP.** Without it a browser whose WebGL is unusable has nothing left but the CPU path, which is slow enough to look like a hang. It permits WebAssembly only - not `eval`, not `new Function`.
- **Detector input cut from 416 to 320.** A third less work for a face that fills the frame, which is the only kind this accepts - anything under 15% of the width is rejected anyway.
- **The reason this reached somebody's phone: the test harness launched Chrome with no camera at all.** `getUserMedia` could never succeed, so every camera path was untestable and therefore untested. The harness now starts with a synthetic camera, and the suite drives the real screen: the camera opens, Capture comes back with an answer, and the button is usable again afterwards. 37 checks in the face suite.
- **Found from a photograph of the screen**, which named the stage precisely. The stage before it had been fixed the same day and looked identical from the outside.
- **Where:** `lib/face/client.ts`, `components/attendance/face-enrolment.tsx`, `next.config.ts`, `tests/e2e/harness.mjs`, `tests/e2e/suites/face-check.mjs`.

### A116. A face that does not match asks for another photo (owner request, 29 Sep 2026)
The owner asked that a swipe whose photograph is not verified should ask for a retake. It did not: a mismatch was recorded immediately and sent for approval, and nothing ever asked for another picture. `maxRetries` had been in the company settings since the check was built - validated, exposed, and read by nothing.

- **A mismatch is now refused, up to the limit.** Nothing is recorded, the camera opens again by itself, and the message says which try this was: *"That does not look like you. Take the photo again, facing the camera in good light."* Somebody half in shadow took a bad photograph rather than committed a fraud, and the honest answer is to take it again.
- **The last try goes through, marked.** Refusing for ever would mean somebody with a new beard, a bandage or bad light cannot clock in, and that becomes an argument about pay - the one thing this must never cause. It is recorded, not approved on the spot, and sent to a person.
- **The check runs before the photograph is stored.** A refused attempt leaves no orphaned file; at three tries each, storing every rejected picture would cost more than the swipes.
- **The camera reopens on its own rather than leaving the rejected photo on screen.** The only useful next action is another picture, and making somebody hunt for the button to do the thing they have just been told to do is a screen arguing with itself. The note they typed is kept.
- **`faceAttempts` is returned by the API now.** It was stored and never surfaced, so a reviewer could not tell one bad photograph from five tries at getting past the check - which is the whole difference between a mistake and an attempt.
- **Verified:** the ladder is walked end to end - first try refused and named `FACE_MISMATCH` with the count, second refused, nothing recorded by either, and the third recorded, flagged, pending, with the attempt count kept. 45 checks in the face suite.
- **Where:** `services/swipeService.ts`, `components/attendance/{use-swipe.ts,swipe-sheet.tsx,swipe-view.tsx}`, `tests/e2e/suites/face-check.mjs`.

### A117. Two more checks that passed for the wrong reason (test fixes, 29 Sep 2026)
Both found while confirming something else. Neither was testing what it claimed.

- **The ledger suite skipped itself.** It takes the month's remaining weekdays for a test holiday and a test leave day; on the 28th there were exactly two, and on the 29th there was one - so the guard fired, the suite returned early, and **thirty-five checks stopped happening**. The total fell from 361 to 335 and nothing objected, because a suite that does not run reports no failures. The fixtures are placed in next month now, which has eighteen weekdays at worst, and the leave allowance is set for both years since next month is January in December. A114 fixed the assertions and left the fixtures behind, which is why it survived one more day.
- **The phone home's timer check read hidden text.** The desktop timer hero is hidden on a phone with `hidden md:flex` - hidden by CSS, still in the DOM - and the check read `textContent("body")`, which sees it regardless. It passed only when a timer happened to be running, because that made the component render its other branch and take the words with it. It now asks whether the element is *visible*, which is the actual claim.

**The pattern, written down because it is now five in three days:** the founding admin's missing code (the suite ran the backfill first), an `<img>` assertion that passed against an empty circle (a broken `src` is still an `<img>`), the ledger's Sunday and Upcoming checks (the date happened to suit them), the ledger suite skipping (its checks left the count silently), and this one. Not one was caught by the suite; every one was caught by somebody looking at a screen. Two of them would have been caught by a runner that refuses to pass when a suite returns fewer checks than last time, which is worth building before anything else in the test layer.

### A118. The description and the picture reach the time report (owner report, 29 Sep 2026)
The owner said the uploaded images and the description were not showing in the time report. They were not showing anywhere. Stopping a timer demands both (A105), and both went into the database and were never seen again - which made demanding them a formality rather than a record of the work.

- **The data was always there.** `notes` and `hasProof` come back on every entry from the same serializer the timesheet uses. `ReportEntry` in the table did not declare either field, so nothing rendered them. Nothing had to change on the server.
- **Opening a person-day now shows, per session, what they wrote and the photograph they took.** The picture is fetched when the row is opened, not with the report: the links are signed and short-lived, and a timesheet of two thousand rows would sign two thousand URLs nobody opens.
- **In the export the description has a column of its own.** It had been glued onto the task with a dash - unsortable, unfilterable, and unreadable at any width a task name also has to fit in, and it is the part somebody opening a report actually wants to read. A "Picture" column says yes or no rather than linking: a signed URL would be dead long before anyone clicked it in a spreadsheet, which is worse than saying yes.
- **The column header says "Task / what they did"**, because it now carries the task, the description and the picture.
- **The test asserts the thumbnail decoded, not that an `<img>` exists** - the same trap the avatar check fell into two days ago, where a broken `src` passed a selector against an empty circle.
- **Verified:** 42 checks in the reports suite, up from 34 - the descriptions appear in the opened sessions, the picture loads, and the CSV carries a Description column, a Picture column, and the words themselves.
- **Where:** `components/reports/entries-table.tsx`, `services/reportService.ts`, `tests/e2e/suites/reports.mjs`.

### A119. The picture opens over the report, not in another tab (owner request, 29 Sep 2026)
A118 put the photograph in the time report as a link with `target="_blank"`. The owner asked for it to open in place, and they are right: a new browser tab throws somebody out of the report they are reading to look at one image, and then leaves them to find their way back to it.

- **The app already had a viewer.** Chat's lightbox handles Escape, arrow keys, download and click-to-close - and it lived in `components/chat/attachments.tsx`, where the reports table could not reach it, so a worse thing was written instead. It is `components/ui/lightbox.tsx` now and both use it, because two viewers that behave differently is worse than one that moved.
- **It takes the least it needs** - a name, a URL, something to download - so anything with a picture can use it without inventing a chat attachment.
- **The test asserts no second tab is opened**, not merely that a dialog appears. The bug was the navigation, so that is the thing to pin.
- **A mistake worth recording:** the check was inserted with `String.replace`, where `$$` in the *replacement* means a literal `$`. `admin.$$(...)` silently became `admin.$(...)`, which returns null rather than an array, and the suite crashed on `.length`. Same family as the rule about never writing regexes through a shell - use a replacer function, or write the file directly.
- **Verified:** 46 checks in the reports suite - the dialog opens over the page, the full picture decodes in it, no second tab is opened, and Escape closes it.
- **Where:** `components/ui/lightbox.tsx`, `components/chat/{attachments,thread}.tsx`, `components/reports/entries-table.tsx`, `tests/e2e/suites/reports.mjs`.

### A120. A face only counts once a person has agreed to it (owner request, 29 Sep 2026)
The hole at the centre of the face check, raised three times and now closed: **nobody verified whose face was enrolled.** Whoever held the phone became that account's face for ever, re-enrolling silently overwrote it, and every swipe afterwards reported "verified". That is worse than having no check, because it produces a record that reads like evidence while being anchored to nothing.

- **An enrolment is pending until somebody approves it.** Until then it does nothing: the swipe is recorded `unverified` - exactly as if nobody had enrolled - and *never* a mismatch. A person waiting on HR's queue has done nothing wrong and must not be turned away at the gate for it.
- **A photograph is taken at enrolment**, privately stored and read through a link that expires. Approving has to mean recognising a face; the descriptor is 128 numbers and cannot be turned back into a picture, so without this a reviewer would be agreeing with a row in a table.
- **Re-enrolling drops the approval.** Otherwise the whole thing is theatre: enrol your own face, have it approved, then quietly replace it with a colleague's and keep the tick.
- **Enrolment has to happen at a work site** (`faceCheck.enrolAtSite`, on by default). The easiest way to enrol somebody else's face is from a sofa, and the phone already knows where it is. It does nothing until work sites exist - refusing everybody for being outside a geofence nobody has drawn would lock a company out of its own feature on day one - and it can be switched off for companies whose office staff work from home.
- **Nobody approves their own.** The point is a second pair of eyes; one person being both of them is not a review.
- **A rejection clears the face and says why.** The only useful next step is enrolling again, and a descriptor nobody trusts has no business staying in the database. The person is notified rather than left to discover it from a supervisor.
- **HR had no screen for any of this.** Not the register, not even the on/off switch - it was all API-only, which is the same shape as the employee-code backfill that had no caller. There is a Face check tab in Settings now: the switch, the threshold, the retry count, the site rule, and the queue of faces waiting, each with its photograph and "That is them" / "Not them".
- **Verified:** 60 checks in the face suite, up from 45 - a fresh enrolment is pending, an unapproved face is unverified but still swipes, an employee cannot approve anyone, deciding twice is refused, re-enrolling returns to pending, and enrolling away from a site or with the location withheld is refused.
- **Still not built: liveness.** A photograph held up to the camera still passes. This closes *who the face belongs to*, not *whether it is a live face*. That is the next piece if a shared device ever sits on an unattended door.
- **Where:** `services/faceService.ts`, `models/{User,Company}.ts`, `app/api/face/enrolment/[userId]/route.ts`, `app/api/me/face/route.ts`, `components/settings/face-check-settings.tsx`, `components/attendance/face-enrolment.tsx`, `lib/validation/face.ts`.

### A121. Clocking in and out is gone; the swipe is the record (owner request, 29 Sep 2026)
The owner asked for clock-in and clock-out to be removed, since swipes already cover it. They were right that it was duplication - but the two were not the same mechanism, and removing the buttons on their own would have stopped everybody's pay.

- **They were entirely separate systems.** A swipe wrote `AttendanceSwipe`. The ledger - and therefore payroll - read `Attendance.clockIn/clockOut`, which only the clock-in button ever wrote. Deleting the button would have left every day with no clock-in, which the ledger counts as **Absent**: a whole company marked away and paid nothing. The swipe had to start writing the day before anything could be taken out.
- **The day is derived from the swipes now.** First on-duty swipe becomes the clock-in and decides Present or Late against that person's shift; the last off-duty swipe closes the day and computes the hours.
- **Recomputed from scratch, never nudged.** That is what makes it safe to run again when a swipe is approved, rejected, or arrives late: the answer depends only on the swipes that currently stand, so it cannot drift. A rejected swipe stops counting and the day is worked out again without it - a person left marked present by a swipe that was thrown out is exactly the discrepancy this change exists to remove.
- **Anything set by hand wins.** Leave, and any day an admin has written a status or note onto, is left alone: recomputing over somebody's decision would silently undo them.
- **The better half of the argument for doing this:** of the two ways to mark a day, the one feeding payroll was the one with *no photograph, no location, no face check and no approval trail*. A day could be paid on a button nobody could check.
- **One behaviour deliberately not carried over.** Clocking out used to stop a running timer silently, which was a way around the compulsory picture and description on a timer stop (A105). It no longer does; an abandoned timer is closed by the end-of-day job that already existed.
- **Verified:** 31 checks in the swipes suite including that swiping creates the day's attendance, that it counts as present rather than absent, and that `/api/attendance/clock-in` is now a 404; the ledger's 36 pass unchanged, which is the real proof - its "today shows the clock-in" check is now satisfied by a swipe alone.
- **Where:** `services/{attendanceService,swipeService}.ts`, `hooks/useTimer.tsx`, `components/{dashboard/mobile-home,dashboard/day-hero,timer/timer-page,timer/stopwatch-widget,attendance/attendance-view}.tsx`, and the two deleted routes under `app/api/attendance/`.

### A122. Two round trips instead of three, and charts that arrive when a chart does (owner request, 29 Sep 2026)
The owner said the app was slow and asked for reasons. Measured rather than guessed: a database round trip is about 33 ms from a laptop on home broadband, a cold Atlas connection 478 ms, and API calls were landing at 122-262 ms.

- **Every authenticated request was making three database round trips before doing any of its own work** - session, then user, then company, one after another. About a tenth of a second on every API call and every page, spent entirely on working out who was asking. The session already carries a denormalised `companyId`, so the user and the company do not depend on each other and are now fetched together. Measured afterwards: `/api/me/profile` 178 to 122 ms, `/api/employees` 173 to 130, `/api/tasks` 122 to 98, `/api/notifications` 128 to 105. One round trip, off everything.
- **The copy is trusted only while it agrees with the user.** Somebody moved between companies since signing in would otherwise keep being served their old one - rare, and far too serious to accept for 33 ms - so a mismatch falls back to the real lookup.
- **recharts arrived with every page that imported a chart card**, whether a chart was on screen or not, because nothing in the app used `next/dynamic` at all. The charts are now fetched when one is actually rendered; `/reports/time` ships 189 B of page JavaScript instead of carrying the largest library in the app.

**A correction worth recording.** I told the owner to check their Atlas and Vercel regions, calling it the biggest available win. It was not: their functions already run in Mumbai, and 33 ms from a home connection to Atlas is consistent with the cluster being in India too - from a Vercel function in the same region that is a few milliseconds, not 33. The number I measured was my own laptop's distance to the database, and I presented it as the server's. Production timings tell a different story: `/login` takes 300 ms consistently, ten hits in a row with no improvement - so not cold starts - on a page that touches no database at all. That is Next.js rendering plus function invocation on a Hobby plan, and it is where the remaining time is.

### A123. The leave balance says something a person can act on (owner report, 29 Sep 2026)
The owner's balance screen read *"0.8 days left of 0.8 earned so far"*. The arithmetic was right - one day a year, nine months in, is 0.75 - and everything around it was wrong.

- **The company had no leave plan.** A new company was created with no policy at all, so every balance read zero until somebody invented numbers; theirs had been set to one day a year. New companies now start with the ordinary Indian allowances - PL 15, CL 12, SL 12 - as a starting point HR can change, not a legal opinion.
- **Accrual lands on half days, rounded down.** There is no way to book eight tenths of a day. Down rather than up, because rounding up hands out leave nobody has earned, and somebody leaving in March is paid for it.
- **Comp off no longer accrues by the calendar.** It is given for working a day that was yours, one at a time. Accruing it monthly handed people days off they had not worked for.
- **The screen is a list, matching the reference the owner sent:** one line per kind, the figure on the right, one decimal. Cards with progress bars were measuring a total that changes every month.
- **Loss of pay and on duty are on it too**, as the reference has them. They carry no entitlement, so the figure is days *taken*, and each row says which - "0.0" would otherwise read identically for somebody who had taken fourteen days unpaid.
- **A test that was checking the old wording** now checks the new format, and reads the figures out of the rows rather than out of `textContent`: run together as "Privilege Leave8.0left", a word boundary never lands between a label and a digit, because both are word characters.

### A124. Unused leave survives the year (owner request, 29 Sep 2026)
The owner asked that leave be added at the start of each month and that unused days remain. The first was already true - a twelfth lands on the 1st, which is why September shows nine twelfths. The second was not: **every balance reset on the 1st of January** and a year of unused earned leave simply disappeared.

- **The balance folds forward year by year** from the year the person joined. What was left at the end of one year opens the next. Their whole history is fetched in one query rather than one per year, so this stays three round trips however long somebody has worked there.
- **Carrying is per kind, and capped.** Earned leave carries, up to thirty days; casual and sick lapse, because they are meant to be used in the year they are given. A cap is what stops a balance growing for a decade into a liability nobody planned for - it is owed in money when somebody leaves.
- **It starts from their joining year**, not from the first policy the company ever wrote, or a new joiner would be credited with leave from before they arrived.
- **A debt is never carried.** More taken than earned is something to settle, not a negative opening balance that quietly eats next year's leave.
- **A bug found on the way:** `setPolicy` wrote `monthlyAccrual ?? true` on every save, so changing the number of days for comp off - which must never accrue - quietly turned accrual back on. It now writes only the fields it was actually sent.
- **Verified:** 7 unit checks on the fold - what carries, what lapses, the cap, an uncapped policy, never carrying a debt, part-year accrual, and half-day rounding.

### A125. The whole year is given on day one (owner request, 29 Sep 2026)
The owner looked at a balance reading 0.5 with nothing taken and said leave should not be cut automatically - only when somebody applies for it. Nothing had been cut: 0.5 was what nine months of a one-day-a-year allowance comes to. But they are right about the screen, and about what the default should be.

- **A number below the allowance reads as a deduction.** "0.5 left" against an allowance of 1, with no leave taken all year, is indistinguishable from half a day having been taken away. No explanation on the row makes that intuition wrong; it makes the design wrong.
- **New companies now get the whole year on the first day.** The balance shows what somebody is allowed, and comes down only by what they have applied for - which is exactly what was asked for.
- **Monthly accrual stays, because it is a real choice** some companies make, and their existing policies still use it. It is a switch on each row of the leave policy editor now instead of a field nobody could reach, and the balance row says *"12/yr, earned monthly"* when it is on, so a figure below the allowance explains itself rather than looking like a cut.
- **Pending requests still come off the balance.** Applying is what spends a day; leaving it out until approval would let somebody apply for the same last day three times over.
- **Verified:** 4 more unit checks - the full allowance in January, the same full allowance in September, coming down only by what was applied for, and an accruing policy still producing the 0.5 that started this.

### A126. A tablet on a wall that takes attendance (owner request, 30 Sep 2026)
The owner has a tablet and asked for a device at the door: somebody walks up, it recognises them, attendance is recorded. Built, and two things about it are genuinely different from the phone.

**It has to work out *who*, not just *whether*.** On a phone somebody is signed in, so the face check answers "is this really them" - one face against one. A door knows nobody until it matches, so it compares against every approved face in the company, which gets harder with every hire. Two guards: a threshold tightened to 0.5 (being wrong at a door marks the wrong person present; being wrong on a phone only fails to confirm somebody already signed in), and **a margin** - the closest face must be clearly closer than the second. Two candidates nearly as good as each other is what siblings and bad light produce, and the honest answer then is "I do not know", which sends somebody to their phone rather than recording a day against the wrong name.

**Liveness, which the phone could live without.** A printed photograph passes a face check. On somebody's own phone the worst they can do with one is fake their own attendance; at an unattended door anybody can hold up a picture of a colleague, and the record says "verified" with a timestamp and a photograph - worse than no record, because it looks like evidence. The check is a blink, measured from the eye landmarks face-api already produces: open, then shut, then open, in that order. A photograph never blinks, and a photograph of somebody with their eyes shut fails too. **It is recorded, not enforced** - somebody the camera cannot see blink must not be locked out of their own attendance - but a run of swipes with no blink is what holding a picture up looks like, and it is findable.

- **The device is the thing trusted, not a person.** Every other session here belongs to somebody; a door has nobody to sign in. A `DoorDevice` holds a hashed token, is bound to one work site, and may do exactly two things: identify a face and record a swipe at that site. It cannot read anybody's record or act outside its company - a tablet by a door is the least physically secure thing in this system and should be the least powerful.
- **The token is shown once.** Stored hashed like a password; losing it costs a minute of registering the device again, which is the right price for not keeping a working key to everybody's attendance in a database. Revoking takes effect on the next request, because the reason to revoke one is that it has walked out of the building.
- **Direction is worked out, not asked.** Nobody at a door should have to tell a tablet which way they are walking: it is the opposite of whatever they did last today.
- **No GPS.** A device bolted to a wall cannot move, and asking it where it is invites the one answer that would be wrong. Its site is a fact somebody set when they hung it up, which is also why a door swipe is approved on the spot.
- **`/kiosk` is public in the sense that no person is signed in**, and not otherwise: the screen does nothing until it holds a device token and the endpoint refuses every request without one.
- **A test that described the order it ran in:** "the first swipe of the day is on duty" passed alone and failed in a full run, where the employee had already swiped from their phone. It asserts the alternation now, which is the actual rule.
- **Verified:** 17 unit checks on identification and liveness - a photograph never passing however long it is held up, refusing to choose between two similar faces, a stricter threshold refusing what a loose one accepts - and 21 browser checks: registering, the token never being handed out twice, an employee refused both, an unapproved face not recognised, a stranger not recognised, the day following from a door swipe, and a revoked device dead at once.
- **Still not built:** an offline queue. A door with no wifi currently stops working, and it should hold the swipes and send them when the connection returns.

### A127. Enrolling a face with the person standing there (owner request, 30 Sep 2026)
The owner asked to type an employee ID, capture that person's face, and have attendance work from it. That is supervised enrolment, and it is the other way round from the phone in a way that matters.

- **On the phone, a person enrols themselves and somebody approves it afterwards** (A120), because nobody watched. **Here the watching is the enrolment:** HR types the code, sees the name come back, and photographs the person in front of them. So it is approved as it is taken - sending it to a queue for the same person to approve later would be a second signature from the same hand, which reviews nothing.
- **It starts with the employee code**, because that is what is printed on a payslip and what people read out. The search did not match on it until now - typing EMP005 found nothing, which made the search look broken and made this flow impossible to start.
- **The name is shown before the camera opens.** Photographing the right face onto the wrong account is the one mistake this screen could make and never notice.
- **Nobody may do it for themselves.** Enrolling your own face this way would approve it in the same breath - the exact hole the approval flow exists to close - so it is refused and points at the ordinary route.
- **No geofence here.** The rule that enrolment happens at a work site (A120) exists because a phone can be anywhere and nobody is watching. A colleague standing in front of the person is a stronger control than a circle on a map, and refusing HR at a branch office with no geofence drawn would only push people back to the weaker path.
- **The old photo is deleted when a new one replaces it**, same as a self-enrolment.
- **Verified:** 8 browser checks - the code being searchable, HR enrolling somebody, it arriving approved rather than pending, the register agreeing, an employee refused, HR refused for their own face, and one capture not being enough.
- **A test of my own that was wrong, not the code:** the descriptors it sent were nudged by 60, and `isDescriptor` refuses anything outside [-10, 10] - so "not enough captures" was correct and the test was sending rubbish.

### A128. A door that keeps working when the wifi does not (owner request, 30 Sep 2026)
The gap left open in A126. A tablet by a gate loses its connection - a router reboots, a site has one bar, somebody unplugs the wrong thing - and it simply stopped, which means people cannot clock in, which becomes an argument about pay.

- **The swipe is held on the device and sent when the connection returns.** IndexedDB rather than localStorage, because a swipe carries a photograph and base64 in a string store inflates a blob by a third.
- **The time is the device's, and it is marked as such.** The server's clock is the rule everywhere else because a device's clock is whatever somebody set it to. A queued swipe has no server to ask, so it carries the time the device saw - unverifiable, and therefore recorded as `timeSource: "device"`. A reviewer looking at a day should be able to tell which entries the server witnessed and which it was merely told about.
- **Refused if the claimed time is more than a day old or in the future**, so a device with a wrong clock cannot write attendance into last week.
- **Direction comes from the swipe *before that moment*, not the newest one.** This is the subtle one: a queued swipe from nine in the morning can arrive after a live one from five in the evening, and taking the latest would give the morning entry the evening's direction and invert both. Asking what came before the moment it happened is right whichever order they arrive in.
- **Replaying cannot record it twice.** The device gives each swipe its own reference, unique per company; a second send returns the one that stands rather than refusing, because from the device's side a refusal looks like failure and it would retry for ever. A connection dropping mid-request is the ordinary case, not the rare one.
- **The queue is bounded** - five hundred swipes, one day - and when it is full the screen says the device cannot store any more rather than quietly dropping the oldest and letting somebody believe they swiped.
- **Sending stops at the first real failure** rather than carrying on: sending the evening before the morning would give every swipe after it the wrong direction.
- **A swipe the server refused is dropped, not retried.** It will be refused again for ever and would block everything behind it.
- **The screen says so.** A door quietly holding a day of attendance and a door working normally look identical from in front of it, so the count sits in the corner.
- **What it cannot do offline: name the person.** Identifying a face needs the enrolled descriptors, which live on the server. The screen says the swipe was saved and will be sent, rather than guessing at a name - and the face is matched when it arrives.
- **Verified:** 30 browser checks in the door suite, including a held swipe arriving late and marked as device-timed, the same one sent twice recording once, one arriving out of order still getting its direction from what preceded it, and times days old or in the future refused.

### A129. The Work Gateway on the admin dashboard (owner request, 30 Sep 2026)
The owner sent four screenshots of another HR system - a launcher wall of about ninety named links, a month-grid attendance authorisation screen, a day-detail approval dialog, and a salary book - and asked for all of it, on the desktop admin dashboard.

**The first piece, and a straight answer about the rest.** What is built here is the gateway: every screen in the company on one wall, grouped and named, so somebody who knows what they want finds it without hunting a sidebar, and somebody who does not can read the whole system at a glance. That is the part of the reference that works, and it is the part that costs a day rather than a quarter.

- **Built from the navigation config, not a second list.** Anything an admin has switched off, or that this role may not see, is absent here too. Two hand-maintained lists would drift apart inside a month and the gateway would start promising screens that are not there.
- **Desktop only, deliberately.** A phone keeps the launcher it has - four tiles and today's swipes - because ninety links on a five-inch screen is a list nobody scrolls. This is the screen somebody sits down at.
- **What is missing is named and greyed rather than left out.** Assets, uniform, TDS and PF statements, memos, swipe exceptions: twenty-nine of them. A launcher that silently omits things reads as a complete system, and then somebody plans a month around a report nobody has written. Unclickable and grey says the true thing, and it doubles as the roadmap.
- **34 live links against 29 not built**, which is the honest shape of the gap between this and the reference.

**What the reference has that this does not, in the order it is worth building:** the month-grid authorisation screen (every employee down, every day across, one cell per day with its status, opening to a dialog that marks leave or attendance with an approval trail) is the daily driver and the largest single piece. Then the salary book's per-branch month view - generate, lock, view slips - which is mostly a screen over payroll that already computes. Then assets and uniform, which is a new domain rather than a view over an old one. Statutory statements last, because they need an accountant's eye more than an engineer's.

### A130. The month somebody signs off before it becomes pay (owner request, 30 Sep 2026)
The centrepiece of the owner's reference, and the piece that was actually missing rather than merely absent. Everything else in the chain already ran on its own - a swipe carries a photograph and a face, the day is derived from the swipes, payroll counts the payable days - and **nowhere in it did a person look at a month and say it was right**. A day somebody forgot to swipe off, or was genuinely away for, went into the pay run either way with nobody in between.

- **Everybody down, every day across.** Built on `attendanceLedger` rather than beside it: that function is the single place that decides what a day was worth, and a grid that recounted days its own way would eventually disagree with the payslip computed from the same month - the one disagreement nobody can argue their way out of.
- **Two letters and a colour, both carrying the meaning.** Thirty-one columns have to fit beside a name, so a word will not do; and the letters are the primary signal rather than decoration on the colour, so the sheet reads for somebody who cannot tell the colours apart.
- **The name column is pinned while the days scroll.** Losing it on the way to the 28th makes the whole screen meaningless.
- **Ledgers are fetched in batches of twelve.** Three hundred people would otherwise open three hundred simultaneous rounds of queries and spend the request being throttled by its own database.
- **The reason for settling a day is required**, and not as a formality: a day changed by hand months later with no note is indistinguishable from a mistake, and these are the entries that move money, so they are the ones that get asked about. It is kept with the change and shown to the person.
- **A settled day wins over the swipes.** `syncAttendanceFromSwipes` already leaves alone anything with `setBy` on it, so a decision is never quietly recomputed away by a swipe arriving late - which is checked, not assumed.
- **Two things the screenshots taught me only once it was on screen:** a day before somebody joined rendered as an empty cell, which reads as a bug rather than as a fact, so it is a faint dash now; and the "this day is not paid" warning was showing on days outside the employment entirely, which would have had HR settling days that were never theirs to work.
- **Verified:** 10 checks - the grid loading with a row per person and a column per day, an employee seeing only themselves, settling refused without a reason, settling accepted with one, an employee unable to settle their own day, and a settled day surviving a later swipe.

### A131. Levels on the approval chain - and the setting swipes were ignoring (owner request, 30 Sep 2026)
The owner asked for Level 1 / Level 2 / Level 3 on attendance swipe approvals, configurable from the admin side, with a level removable when there is no team lead. Most of that already existed from A104 - reorder, remove, add back, HR pinned last. Two things did not.

- **Nothing said which level a step was.** A chain that is three steps in one company and two in another needs to name the position, or "Manager" quietly means something different in each and nobody notices until a request sits in the wrong queue. The editor rows now read *Level 1 · Team Lead*, and every approval trail - swipes and leave - shows **L1**, **L2**, **L3** beside the role.

- **And the bug underneath it: swipes were ignoring the setting entirely.** `swipeService` had its own private chain builder, hardcoded as team lead, then manager, then HR. It was written in A83, before the order became something an admin sets in A104; the leave side moved to the shared builder and the swipe side never did. So a company that dropped the team lead level got the setting saved, the screen showing it, and **three-step swipe approvals regardless** - approvals waiting on a person the company had deliberately removed from the chain.

  Nothing caught it because the chain was only ever tested through leave. A104's own note said the two shared one chain, which was true of the intention and not of the code. Swipes use the shared builder now, so there is one answer to "who approves" and both kinds of request get it.

- **Verified:** the chain set to three steps produces a three-step swipe; dropped to two, the next swipe has two with the manager first, and the lead can no longer decide it. Checked on the swipe side specifically, which is the side that was wrong.

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
- **The installer is unsigned,** so SmartScreen warns on first run and the page says so. A certificate is the only fix and it is a paid, yearly one.
- **Three traps found while building, all documented in `DESKTOP.md`:** electron-builder 26 hits `EPERM` renaming its extraction folder on a machine with live virus scanning (the repo stays on 25, which does not); its signing tool unpacks macOS symlinks and needs Windows Developer Mode; and a VS Code terminal exports `ELECTRON_RUN_AS_NODE=1`, which makes any Electron binary run as plain Node and exit at once - that is why the packaged app first appeared to start and immediately die.
- **Verified:** 13 checks - the packaged `WorkPulse.exe` opens, loads `https://app.broaddcast.com`, renders the real login page (not the offline fallback) and exposes `window.workpulseDesktop`; and `/download` opens with no session without bouncing to login, answers 200 with no page errors, offers both platforms with the right file links and the version, explains iPhone, and does not overflow at 390px.
- **Where:** `desktop/**` (new), `.github/workflows/apps.yml` (new), `app/download/page.tsx` (new), `DESKTOP.md` (new), `middleware.ts`, `lib/env.ts`, `tsconfig.json`, `.gitignore`, `.env.example`.

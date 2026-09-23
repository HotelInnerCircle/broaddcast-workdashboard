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

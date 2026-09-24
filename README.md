# WorkPulse

Multi-tenant work management & time tracking SaaS. Built phase by phase from `WorkPulse-Build-Spec-v2.pdf`; see `ASSUMPTIONS.md` for every decision the spec left open.

**Status: all six phases complete** - Foundation; Clients, Projects, Tasks; Timer, Breaks, Attendance, Timesheets; Reports, Metrics, Exports; Realtime, Chat, Notifications, Activity, Search; SaaS layer (plans & limits, Super Admin, subscriptions, audit viewers, optional Razorpay).

## Stack

Next.js 15 (App Router) · TypeScript · React 19 · Tailwind CSS v4 · MongoDB + Mongoose 9 · Zod · React Hook Form · Auth.js v5 (Credentials, database sessions) · Socket.IO on a custom Node server · Nodemailer · ImageKit file storage · Docker.

## Run locally

```bash
cp .env.example .env        # set MONGODB_URI, AUTH_SECRET, SUPERADMIN_EMAIL/PASSWORD, IMAGEKIT_*
npm install
npm run dev                 # http://localhost:3000 (Next + Socket.IO on one port)
```

On start the server bootstraps an empty database: it creates the default plans (Starter / Business / Enterprise) and the Super Admin from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` (`lib/bootstrap.ts`). Sign in as the Super Admin and create the first company from Companies -> New company. Changing `SUPERADMIN_PASSWORD` in `.env` and restarting rotates the Super Admin password.

Leave `SMTP_HOST` empty in development: emails are printed to the console and appended to `.dev/outbox.jsonl`.

## Mobile apps

Native Android/iOS apps are built with Capacitor in remote-URL mode (the shell loads the deployed site). Setup, build and store-deployment commands: **[MOBILE.md](MOBILE.md)**. (A65)

## Android app (PWA route: APK / Play Store)

The app is an installable PWA (manifest, service worker, offline page). To ship it as an Android app:

1. Deploy on a public **https://** domain (e.g. https://app.yourdomain.com) - the Android wrapper loads the live site.
2. Go to https://www.pwabuilder.com, enter the URL, choose **Android** -> download the package. You get an `.apk` (side-load / share) and an `.aab` (Play Store), plus the signing key - keep it safe.
3. Put the values PWABuilder shows into `.env` on the server: `ANDROID_PACKAGE_NAME` (e.g. com.broaddcast.workpulse) and `ANDROID_CERT_SHA256` (signing certificate fingerprint; after Play app-signing, use the one from Play Console -> App signing). `/.well-known/assetlinks.json` then verifies the app so it opens full-screen without a browser bar.
4. Create the app in Google Play Console, upload the `.aab`, fill the listing, submit for review.

Replace the placeholder icons in `public/icons/` with your brand PNGs (192x192, 512x512, and a 512x512 maskable with safe padding) before packaging.

## Security notes

- Never commit `.env` (ignored). Copy `.env.example`, generate `AUTH_SECRET` with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`, and set a strong `SUPERADMIN_PASSWORD` before the first seed.
- A production start refuses placeholder secrets, non-https `APP_URL` and a localhost database (`lib/security/startup-checks.ts`); local production runs only warn.
- Responses carry CSP, HSTS (https only), X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy headers. See ASSUMPTIONS.md A59.

## Production / Docker

```bash
npm run build && npm start          # next build + esbuild server bundle -> dist/server.js
docker compose up --build           # app + MongoDB
```

## Design

Bento layout (dark icon rail, colour KPI tiles, floating rounded cards) in the Linen palette (warm paper, cocoa accent) with Instrument Serif display type and DM Sans body. Every colour is a CSS token in `app/globals.css` (light + warm dark), fonts are wired in `app/layout.tsx`, and `font-display` is the utility for serif display text. See ASSUMPTIONS.md A49.

## Layout

```
app/(auth)/            login, register, forgot/reset password, invite/[token]
app/(dashboard)/       shell + role segments (super-admin, admin, manager, team, employee) + shared pages
app/api/               route handlers (Zod-validated, standard error/pagination shapes)
components/            ui/ (design system), layout/, dashboard/, employees/, teams/, settings/, auth/
config/                brand.ts (single branding source), navigation.ts (sidebar, filtered by permissions)
lib/                   auth/, db/ (tenant-scoped DAL + guard), permissions.ts, audit.ts, limits.ts,
                       email/, storage/, realtime/, validation/, api/, utils/
models/                Mongoose models
services/              business logic (server only)
server.ts              custom server hosting Next.js and Socket.IO
```

Key rules: every tenant query goes through `scoped(Model, ctx)`; every mutation that matters calls `audit()`; permissions live only in `lib/permissions.ts`; the client never decides.

## Owner changes after Phase 6 (21 Sep 2026)

- Only the Super Admin creates companies (Companies -> New company; the first admin is invited by email) and only the Super Admin can delete a company (type-to-confirm; removes all tenant data). Public registration is gone. (A55)
- Timers run on a Client plus a mandatory note about what is being worked on; project/task are attached only when started from a task page. Stopping asks to confirm/refine the note. (A53, A58)
- Employees -> Add employee creates an account directly with a password (credentials shown once to hand over) or sends an email invitation; the Super Admin can likewise set the first admin password when creating a company. (A56)
- Settings -> Company -> Services you offer: the admin maintains what the company sells (Creatives, Meta Ads, ...); each client then has checkboxes for what they have taken, shown as chips on the clients list and client page. (A69)
- Settings -> Company -> Job designations: the admin maintains job titles (Web Developer, Designer, ...) that appear as a Designation dropdown when adding or editing people; separate from the fixed access roles. (A57)
- Sidebar > ADMIN > Menu visibility: the admin switches sidebar items on or off per role while features are rolled out; hiding is menu-only (permissions are unchanged and a direct link still works) and one button shows everything again. (A71)
- Managers and the Company Admin add clients: a manager's clients are visible to everyone who reports to them, an admin's to the whole company. (A61, A70)
- Daily reports notify the employee's team lead when submitted, and lock at the end of their day: editable all through the day it covers, read-only afterwards, with past days listed by date only. (A77)
- Real-time works on serverless hosts by setting ABLY_API_KEY: events go through Ably instead of Socket.IO, with presence, typing and instant delivery. Unset, or unreachable, it falls back to Socket.IO and then to polling. (A76)
- On a host with no WebSocket server the app detects it once and runs on HTTP polling instead of retrying forever: no console errors, messages within a few seconds, chime and badge still work. Typing indicators and instant delivery need a persistent Node process. (A75)
- Online/offline works with or without a WebSocket: the browser heartbeats over the socket when there is one and over HTTP when there is not, so presence is right on a serverless host too (accurate to about a minute there, instant with a socket). (A74)
- Chat also has the full emoji set with search, message forwarding (attachments are copied, so the forward survives the original being deleted), and an incoming-message chime with optional desktop notifications, toggled from the chat header. (A73)
- Chat is WhatsApp-style: sent/delivered/read ticks, several photos and documents per message with previews before sending, downloads, an image viewer, day separators, unread counts and typing indicators. Team Leads and above can create channels with their own member list; employees see only the channels they are in. (A72)
- Chat delivers instantly (optimistic send, reconnect-safe rooms, catch-up + 15 s poll); employees can start DMs from the people picker. (A62)
- Every page is responsive from 320px up: tables become card lists on phones, wide report tables pin their first column, and the phone home screen has its own layout. (A66, A67)
- Visited pages and list data are cached client-side (router cache 60 s, GET cache with background refresh, busted by any change or realtime event), so revisiting a page does not reload from the database. Run the production build (`npm run build && npm start`) for real use - `npm run dev` compiles each page on first open and is much slower. (A63)
- File storage is ImageKit only (`IMAGEKIT_PUBLIC_KEY`, `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT` are required); the S3 and local-disk drivers were removed. (A54)

## Payments (optional)

Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` to enable online upgrades on Settings > Subscription; point the Razorpay webhook (events `payment.captured` / `order.paid`) at `POST /api/billing/webhook`. Without keys, plans are assigned by the Super Admin (Super Admin > Companies / Plans) and the limit system works unchanged.

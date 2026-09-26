/**
 * The bits every end-to-end suite needs: a browser, a signed-in page, and a way
 * to say what passed.
 *
 * These suites drive a real browser against a real server and a real database,
 * because that is where the bugs this project has actually shipped were living:
 * a permissions header that made geolocation impossible, a scope filter that a
 * spread quietly erased, a login screen that rendered blank. None of those are
 * visible to a unit test.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..", "..");

/** Where the run writes screenshots and the throwaway company's details. */
export const WORK = process.env.E2E_WORK_DIR ?? path.join(ROOT, ".e2e");
fs.mkdirSync(WORK, { recursive: true });

/** Load .env the same way Next does, so SUPERADMIN_* and the DB URI are there. */
require("@next/env").loadEnvConfig(ROOT);

export const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

/**
 * Playwright is installed without browsers (playwright-core), so we borrow the
 * Chrome that is already on the machine. Set E2E_CHROME to point somewhere else.
 */
const CHROME_CANDIDATES = [
  process.env.E2E_CHROME,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

export function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
  if (!found) {
    throw new Error(
      `No Chrome found. Looked in:\n  ${CHROME_CANDIDATES.join("\n  ")}\n` +
      `Install Chrome or set E2E_CHROME to its executable.`,
    );
  }
  return found;
}

export async function launch() {
  const { chromium } = require("playwright-core");
  return chromium.launch({ executablePath: findChrome(), headless: process.env.E2E_HEADED !== "1" });
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A phone, including its user agent.
 *
 * The viewport alone is not enough: the server decides what kind of device
 * signed in by reading the user agent, so a "mobile" context that still says
 * Chrome-on-Windows is not testing the mobile path at all.
 */
export const PHONE_UA = "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const PHONE = { viewport: { width: 390, height: 820 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: PHONE_UA };
const DESKTOP = { viewport: { width: 1440, height: 1000 } };

/**
 * Sign in and hand back the page. Waits for the URL to leave /login rather than
 * for a fixed time, because where you land depends on your role.
 *
 * It tries twice. Signing in costs a bcrypt comparison and a session write, and
 * a dev server compiling a route at the same time can take long enough that the
 * first attempt lands back on /login with nothing to show for it. A second try
 * is cheaper than a suite that fails for a reason that has nothing to do with
 * what it was testing - and if it fails twice, the error says what was on screen.
 */
export async function login(browser, email, password, { mobile = false, permissions = [], geolocation } = {}) {
  const ctx = await browser.newContext({
    ...(mobile ? PHONE : DESKTOP),
    ...(permissions.length ? { permissions } : {}),
    ...(geolocation ? { geolocation } : {}),
  });
  const page = await ctx.newPage();
  // First line only: a React hydration error arrives with the whole component
  // tree attached, and hundreds of lines of it buries the checks.
  page.on("pageerror", (e) => console.log(`  [pageerror] ${email}: ${e.message.split("\n")[0].slice(0, 160)}`));

  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 40_000 });
      return page;
    } catch {
      if (attempt === 3) {
        const shown = await page.textContent('[role="status"], .text-danger').catch(() => null);
        throw new Error(`could not sign in as ${email} - still on ${page.url()}${shown ? ` (${shown.trim()})` : " with no error shown"}`);
      }
      // Most likely the sign-in rate limit (10 per IP per minute). Its window is
      // a minute, so waiting it out is the only thing that helps.
      await wait(attempt * 25_000);
    }
  }
  return page;
}

/**
 * One signed-in page per person, kept for the whole run.
 *
 * Sign-in is rate limited to ten attempts a minute per IP, which the whole run
 * shares. Logging five people in per suite blows through that by the third
 * suite, and the failure looks like a broken login rather than a limit doing its
 * job. Signing each person in once and handing the same page back is well under
 * the limit, and quicker besides.
 */
const pool = new Map();

export async function signedIn(browser, email, password, opts = {}) {
  const key = `${email}|${opts.mobile ? "phone" : "desktop"}`;
  const open = pool.get(key);
  if (open && !open.isClosed()) return open;
  const page = await login(browser, email, password, opts);
  pool.set(key, page);
  return page;
}

/** Several of them, in order - never `Promise.all`, which races the rate limit. */
export async function signedInEach(browser, password, emails, opts) {
  const pages = [];
  for (const email of emails) pages.push(await signedIn(browser, email, password, opts));
  return pages;
}

/** A JSON call made from inside the page, so it carries the session cookie. */
export const call = (page, url, body, method = "POST") =>
  page.evaluate(async ([u, b, m]) => {
    const r = await fetch(u, {
      method: m,
      headers: { "content-type": "application/json" },
      ...(b ? { body: JSON.stringify(b) } : {}),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [url, body, method]);

/** The same, as multipart - leave and profile take form data because of the file fields. */
export const form = (page, url, fields, method = "POST") =>
  page.evaluate(async ([u, f, m]) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null) fd.append(k, v);
    const r = await fetch(u, { method: m, body: fd });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [url, fields, method]);

/** Screenshots land in the work directory, named after the suite. */
export const shot = (page, name) => page.screenshot({ path: path.join(WORK, `${name}.png`), fullPage: true });

/** Collects results for one suite and prints them as they happen. */
export function reporter(suiteName) {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok: Boolean(ok), detail });
    console.log(`  ${ok ? "\u2713" : "\u2717"} ${name}${detail && !ok ? ` -- ${detail}` : ""}`);
    return Boolean(ok);
  };
  check.suite = suiteName;
  check.results = results;
  return check;
}

/** Fails loudly if nobody is serving the app - otherwise every suite fails for the same boring reason. */
export async function assertServerUp() {
  try {
    const res = await fetch(`${BASE}/login`, { redirect: "manual" });
    if (res.status >= 500) throw new Error(`${BASE}/login returned ${res.status}`);
  } catch (e) {
    throw new Error(`Nothing is answering at ${BASE} (${e.message}).\nStart it with \`npm run dev\`, or point E2E_BASE_URL somewhere else.`);
  }
}

/**
 * Waits for text to appear rather than sleeping for a guessed number of seconds.
 *
 * A dev server compiles a route the first time it is asked for, which can take
 * longer than any sleep worth writing; a fixed wait either flakes or slows every
 * run down to the worst case.
 */
export async function waitForText(page, pattern, timeout = 30_000) {
  const source = pattern instanceof RegExp ? pattern.source : String(pattern);
  const flags = pattern instanceof RegExp ? pattern.flags : "";
  try {
    await page.waitForFunction(
      ([s, f]) => new RegExp(s, f).test(document.body?.textContent ?? ""),
      [source, flags],
      { timeout, polling: 250 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * A swipe, photo and all, exactly as the phone sends it.
 *
 * The canvas stands in for the camera: the server stamps and stores whatever
 * arrives, so a flat rectangle exercises the same path a real photograph would.
 * Shared rather than copied because more than one suite needs a day with swipes
 * on it, and a suite that depends on another suite having run first fails alone
 * for reasons that have nothing to do with what it is testing.
 */
export const swipePhoto = (page, type, lat, lng, accuracy = 8) =>
  page.evaluate(async ([t, la, ln, acc]) => {
    const blob = await new Promise((res) => {
      const c = document.createElement("canvas");
      c.width = 640; c.height = 860;
      const x = c.getContext("2d");
      x.fillStyle = "#5a7a96";
      x.fillRect(0, 0, 640, 860);
      c.toBlob(res, "image/jpeg", 0.8);
    });
    const fd = new FormData();
    fd.append("photo", new File([blob], "swipe.jpg", { type: "image/jpeg" }));
    fd.append("type", t);
    fd.append("lat", String(la));
    fd.append("lng", String(ln));
    fd.append("accuracyMeters", String(acc));
    const r = await fetch("/api/attendance/swipes", { method: "POST", body: fd });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, [type, lat, lng, accuracy]);

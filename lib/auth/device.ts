/**
 * What kind of thing is signing in, and what to call it on screen.
 *
 * This decides which sessions compete with each other: signing in on a phone
 * ends the previous phone's session, while a desktop or a browser tab is left
 * alone. That is the shape the owner asked for - stop one login being shared
 * around so somebody else can swipe attendance, without stopping HR having the
 * desktop app open while their phone is in their pocket.
 *
 * **This is a workflow control, not a security boundary.** A user agent is sent
 * by the client and can say anything, so somebody determined could claim to be a
 * desktop and hold a second session. Making it tamper-resistant needs an id from
 * the native layer rather than a header. What it does do is stop the casual case,
 * which is the one that actually happens.
 */

export type DeviceKind = "mobile" | "desktop";

export interface DeviceInfo {
  kind: DeviceKind;
  /** Something a person would recognise as their own device. */
  label: string;
}

/** Electron sets this in the desktop shell's user agent; a phone never does. */
const DESKTOP_SHELL = /Electron/i;
const PHONE = /Android|iPhone|iPod|Windows Phone|IEMobile/i;
const TABLET = /iPad|Tablet|Silk/i;

function osOf(ua: string): string {
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/CrOS/i.test(ua)) return "ChromeOS";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "an unknown system";
}

function browserOf(ua: string): string {
  // Order matters: Edge and Opera both claim to be Chrome, and Chrome claims Safari.
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Chrome\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua)) return "Safari";
  return "a browser";
}

export function describeDevice(userAgent: string | null | undefined): DeviceInfo {
  const ua = (userAgent ?? "").trim();
  if (!ua) return { kind: "desktop", label: "An unknown device" };

  // The desktop shell is checked first: it runs Chrome's engine and would
  // otherwise be read as whatever Chrome reports underneath.
  if (DESKTOP_SHELL.test(ua)) return { kind: "desktop", label: `WorkPulse desktop app on ${osOf(ua)}` };

  // A tablet is deliberately counted as a desktop: it is not the phone somebody
  // carries to a work site, and treating it as one would end their phone session
  // every time they picked it up.
  if (TABLET.test(ua)) return { kind: "desktop", label: `A tablet (${osOf(ua)})` };

  if (PHONE.test(ua)) {
    // The native shells identify themselves; a phone browser does not.
    const app = /WorkPulse/i.test(ua) ? "WorkPulse app" : browserOf(ua);
    return { kind: "mobile", label: `${app} on ${osOf(ua)}` };
  }

  return { kind: "desktop", label: `${browserOf(ua)} on ${osOf(ua)}` };
}

/** "3 minutes ago", for telling somebody where their other session is. */
export function sinceLabel(at: Date | string | null | undefined): string {
  if (!at) return "at an unknown time";
  const ms = Date.now() - new Date(at).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

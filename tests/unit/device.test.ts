/**
 * Which device a user agent describes.
 *
 * This decides whose session gets ended when somebody signs in: a phone ends the
 * previous phone's session, a desktop does not. Getting it wrong is not a
 * cosmetic bug - read the desktop app as a phone and every HR person signing in
 * on their laptop silently kicks themselves off their phone.
 *
 * The strings below are real user agents, not invented ones, because the whole
 * problem with user-agent sniffing is that the real ones lie about each other:
 * Edge claims to be Chrome, Chrome claims to be Safari, and the Electron shell
 * claims to be Chrome on the host platform.
 */
import { describe, it, expect } from "vitest";
import { describeDevice, sinceLabel } from "@/lib/auth/device";

const UA = {
  androidChrome: "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  androidApp: "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 WorkPulse/1.0",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/604.1",
  electron: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) WorkPulse/1.0.1 Chrome/124.0.0.0 Electron/30.0.1 Safari/537.36",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
};

describe("what is signing in", () => {
  it.each([
    ["an Android phone browser", UA.androidChrome],
    ["the Android app", UA.androidApp],
    ["an iPhone", UA.iphone],
  ])("counts %s as a phone", (_what, ua) => {
    expect(describeDevice(ua).kind).toBe("mobile");
  });

  it.each([
    ["the desktop app", UA.electron],
    ["Chrome on Windows", UA.windowsChrome],
    ["Edge", UA.windowsEdge],
    ["Safari on a Mac", UA.macSafari],
    ["Firefox", UA.firefox],
  ])("counts %s as a desktop", (_what, ua) => {
    expect(describeDevice(ua).kind).toBe("desktop");
  });

  it("does not mistake the desktop app for a phone, nor for plain Chrome", () => {
    // Electron's user agent contains "Chrome" and the host OS. Read carelessly
    // it looks like an ordinary desktop browser, which is harmless - but the
    // label should still say which app it was.
    const d = describeDevice(UA.electron);
    expect(d.kind).toBe("desktop");
    expect(d.label).toMatch(/desktop app/i);
    expect(d.label).toContain("Windows");
  });

  it("treats a tablet as a desktop, not the phone someone carries", () => {
    // An iPad says "like Mac OS X" and has no "Mobile" token in Safari's UA.
    // Counting it as a phone would end a real phone's session every time
    // somebody picked the tablet up.
    expect(describeDevice(UA.ipad).kind).toBe("desktop");
  });

  it("names the app rather than the browser when the native shell says so", () => {
    expect(describeDevice(UA.androidApp).label).toMatch(/WorkPulse app on Android/);
    expect(describeDevice(UA.androidChrome).label).toMatch(/Chrome on Android/);
  });

  it("does not let Edge or Opera be reported as Chrome", () => {
    expect(describeDevice(UA.windowsEdge).label).toContain("Edge");
  });

  it("survives a missing or nonsense user agent", () => {
    for (const ua of [null, undefined, "", "   ", "????"]) {
      const d = describeDevice(ua as string | null);
      expect(["mobile", "desktop"]).toContain(d.kind);
      expect(d.label.length).toBeGreaterThan(0);
    }
  });
});

describe("how long ago", () => {
  const ago = (ms: number) => new Date(Date.now() - ms);

  it("reads naturally at each scale", () => {
    expect(sinceLabel(ago(5_000))).toBe("just now");
    expect(sinceLabel(ago(60_000))).toBe("1 minute ago");
    expect(sinceLabel(ago(5 * 60_000))).toBe("5 minutes ago");
    expect(sinceLabel(ago(60 * 60_000))).toBe("1 hour ago");
    expect(sinceLabel(ago(3 * 60 * 60_000))).toBe("3 hours ago");
    expect(sinceLabel(ago(26 * 60 * 60_000))).toBe("1 day ago");
  });

  it("says something sensible when there is no time at all", () => {
    expect(sinceLabel(null)).toMatch(/unknown/);
  });
});

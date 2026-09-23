/**
 * Small helpers for the native shell (A65). Everything degrades to a no-op in a browser, so the
 * website is unaffected and nothing from Capacitor lands in the web bundle at import time.
 */
export async function isNative(): Promise<boolean> {
  try { const { Capacitor } = await import("@capacitor/core"); return Capacitor.isNativePlatform(); } catch { return false; }
}

/** Removes this device's push token server-side before the session is destroyed. */
export async function unregisterPushDevice(): Promise<void> {
  if (!(await isNative())) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const token = await new Promise<string | null>((resolve) => {
      let done = false;
      void PushNotifications.addListener("registration", (t) => { if (!done) { done = true; resolve(t.value); } }).then((h) => {
        setTimeout(() => { if (!done) { done = true; resolve(null); } void h.remove(); }, 1500);
      });
      void PushNotifications.register();
    });
    if (!token) return;
    const { api } = await import("@/lib/api/client");
    await api("/api/me/devices", { method: "DELETE", json: { token } });
  } catch { /* logout must never be blocked by push cleanup */ }
}

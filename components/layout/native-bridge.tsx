"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/lib/api/client";

/**
 * Native shell integration (A65). Renders nothing and does nothing in a normal browser: every
 * Capacitor module is imported lazily and only when `Capacitor.isNativePlatform()` is true, so the
 * website bundle is unaffected.
 *
 * Handles: status bar + splash, keyboard resize, Android hardware back button, offline/online
 * toasts, and push-notification registration (token is sent to /api/me/devices).
 */
export function NativeBridge() {
  const router = useRouter();

  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform() || disposed) return;
      document.documentElement.classList.add("native-app");

      // Status bar + splash
      try {
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        const dark = document.documentElement.classList.contains("dark");
        await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
        if (Capacitor.getPlatform() === "android") await StatusBar.setBackgroundColor({ color: dark ? "#1a1714" : "#f4f0e8" });
      } catch { /* plugin unavailable */ }
      try { const { SplashScreen } = await import("@capacitor/splash-screen"); await SplashScreen.hide(); } catch { /* ignore */ }

      // Android hardware back: navigate back inside the app, exit only from a root screen.
      try {
        const { App } = await import("@capacitor/app");
        const back = await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack && window.history.length > 1) router.back();
          else void App.exitApp();
        });
        cleanups.push(() => void back.remove());
        // Re-focus: refresh session-dependent data when the app returns to the foreground.
        const state = await App.addListener("appStateChange", ({ isActive }) => { if (isActive) window.dispatchEvent(new Event("focus")); });
        cleanups.push(() => void state.remove());
      } catch { /* ignore */ }

      // Offline / online feedback (the web app already handles retries).
      try {
        const { Network } = await import("@capacitor/network");
        const net = await Network.addListener("networkStatusChange", (s) => {
          if (!s.connected) toast.error("You are offline", { id: "net", duration: Infinity });
          else { toast.dismiss("net"); window.dispatchEvent(new Event("focus")); }
        });
        cleanups.push(() => void net.remove());
      } catch { /* ignore */ }

      // Push notifications: register only after permission is granted; token goes to the server.
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const perm = await PushNotifications.checkPermissions();
        const granted = perm.receive === "granted" ? perm : await PushNotifications.requestPermissions();
        if (granted.receive === "granted") {
          const reg = await PushNotifications.addListener("registration", (t) => {
            void api("/api/me/devices", { method: "POST", json: { token: t.value, platform: Capacitor.getPlatform() } }).catch(() => {});
          });
          const tap = await PushNotifications.addListener("pushNotificationActionPerformed", (e) => {
            const link = (e.notification.data as { link?: string } | undefined)?.link;
            if (link) router.push(link);
          });
          const recv = await PushNotifications.addListener("pushNotificationReceived", (n) => {
            // Foreground: the in-app realtime toast already covers this; show one only if the socket is down.
            if (!document.hasFocus()) return;
            toast(n.title ?? "WorkPulse", { description: n.body ?? undefined });
          });
          cleanups.push(() => { void reg.remove(); void tap.remove(); void recv.remove(); });
          await PushNotifications.register();
        }
      } catch { /* push not configured (no google-services.json yet) - the app still works */ }
    })();

    return () => { disposed = true; cleanups.forEach((c) => c()); };
  }, [router]);

  return null;
}

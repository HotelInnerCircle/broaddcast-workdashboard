import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor in remote-URL mode (A65): the native shell loads the deployed Next.js app instead of
 * bundling static files, because this app needs SSR, 76 API routes, middleware and Socket.IO -
 * `output: "export"` is not possible. `androidScheme: "https"` + `hostname` make the WebView origin
 * the real domain, so the Auth.js session cookie stays first-party (SameSite=Lax keeps working).
 *
 * MOBILE_URL overrides the target for development (e.g. a LAN URL or a tunnel).
 */
const url = process.env.MOBILE_URL ?? "https://app.broaddcast.com";
const { hostname } = new URL(url);

const config: CapacitorConfig = {
  appId: "com.broaddcast.workpulse",
  appName: "WorkPulse",
  // Only used when a local bundle is served; in remote mode the shell loads `server.url`.
  webDir: "public",
  server: {
    url,
    hostname,
    androidScheme: "https",
    iosScheme: "https",
    cleartext: url.startsWith("http://"),
  },
  android: { backgroundColor: "#f4f0e8", allowMixedContent: false },
  ios: { backgroundColor: "#f4f0e8", contentInset: "always", limitsNavigationsToAppBoundDomains: false },
  plugins: {
    SplashScreen: { launchShowDuration: 1200, launchAutoHide: true, backgroundColor: "#2a2620", androidScaleType: "CENTER_CROP", showSpinner: false, splashFullScreen: true, splashImmersive: false },
    StatusBar: { style: "DARK", backgroundColor: "#2a2620", overlaysWebView: false },
    Keyboard: { resize: "native", resizeOnFullScreen: true },
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;

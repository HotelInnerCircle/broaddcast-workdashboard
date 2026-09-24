/** Central env access. Reads lazily so scripts and the server share one definition. */
function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  get MONGODB_URI() { return req("MONGODB_URI", "mongodb://localhost:27017/workpulse"); },
  get AUTH_SECRET() { return req("AUTH_SECRET"); },
  get APP_URL() { return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""); },
  get NODE_ENV() { return process.env.NODE_ENV ?? "development"; },
  get isProd() { return process.env.NODE_ENV === "production"; },
  get SMTP_HOST() { return process.env.SMTP_HOST ?? ""; },
  get SMTP_PORT() { return Number(process.env.SMTP_PORT ?? 587); },
  get SMTP_USER() { return process.env.SMTP_USER ?? ""; },
  get SMTP_PASS() { return process.env.SMTP_PASS ?? ""; },
  get EMAIL_FROM() { return process.env.EMAIL_FROM ?? "WorkPulse <no-reply@workpulse.local>"; },
  get IMAGEKIT_PUBLIC_KEY() { return process.env.IMAGEKIT_PUBLIC_KEY ?? ""; },
  get IMAGEKIT_PRIVATE_KEY() { return process.env.IMAGEKIT_PRIVATE_KEY ?? ""; },
  get IMAGEKIT_URL_ENDPOINT() { return (process.env.IMAGEKIT_URL_ENDPOINT ?? "").replace(/\/$/, ""); },
  get MAX_UPLOAD_MB() { return Number(process.env.MAX_UPLOAD_MB ?? 10); },
  get SUPERADMIN_EMAIL() { return process.env.SUPERADMIN_EMAIL ?? ""; },
  get SUPERADMIN_PASSWORD() { return process.env.SUPERADMIN_PASSWORD ?? ""; },
  /** Firebase service-account JSON (raw or base64) for FCM push; empty = push disabled. */
  get FIREBASE_SERVICE_ACCOUNT() { return process.env.FIREBASE_SERVICE_ACCOUNT ?? ""; },
  /** Ably realtime (A76). Empty = fall back to Socket.IO, or to HTTP polling when there is no socket either. */
  get ABLY_API_KEY() { return process.env.ABLY_API_KEY ?? ""; },
  /** Where the built apps are hosted (A82). Empty = that platform shows as not published yet. */
  get DOWNLOAD_ANDROID_URL() { return process.env.DOWNLOAD_ANDROID_URL ?? ""; },
  get DOWNLOAD_WINDOWS_URL() { return process.env.DOWNLOAD_WINDOWS_URL ?? ""; },
  get DOWNLOAD_VERSION() { return process.env.DOWNLOAD_VERSION ?? ""; },
  get RAZORPAY_KEY_ID() { return process.env.RAZORPAY_KEY_ID ?? ""; },
  get RAZORPAY_KEY_SECRET() { return process.env.RAZORPAY_KEY_SECRET ?? ""; },
  get RAZORPAY_WEBHOOK_SECRET() { return process.env.RAZORPAY_WEBHOOK_SECRET ?? ""; },
};

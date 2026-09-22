/**
 * Refuses to boot a production server with placeholder or weak secrets (A59). Development, and a
 * production build run locally (APP_URL on localhost), only warn so a fresh clone still runs.
 */
const PLACEHOLDER_SECRETS = ["change-me", "dev-secret", "please-change", "secret", "password", "changeme"];
const PLACEHOLDER_PASSWORDS = ["SuperAdmin@123", "Demo@1234", "password", "admin"];

export function runStartupChecks(): void {
  const appUrl = process.env.APP_URL ?? "";
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(appUrl);
  const prod = process.env.NODE_ENV === "production" && !local;
  const problems: string[] = [];

  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) problems.push("AUTH_SECRET must be at least 32 random characters (generate: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\")");
  else if (PLACEHOLDER_SECRETS.some((p) => secret.toLowerCase().includes(p))) problems.push("AUTH_SECRET is still a placeholder value");

  const sa = process.env.SUPERADMIN_PASSWORD ?? "";
  if (sa && (PLACEHOLDER_PASSWORDS.includes(sa) || sa.length < 12)) problems.push("SUPERADMIN_PASSWORD is a default/short value - set a strong unique password (12+ chars)");

  if (prod && !appUrl.startsWith("https://")) problems.push("APP_URL must be https:// in production (session cookies are only marked Secure over https)");

  const webhook = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  if (webhook && (webhook.length < 16 || PLACEHOLDER_SECRETS.some((p) => webhook.toLowerCase().includes(p)))) problems.push("RAZORPAY_WEBHOOK_SECRET is weak or a placeholder");

  if (process.env.MONGODB_URI?.includes("localhost") && prod) problems.push("MONGODB_URI points at localhost in production");

  if (problems.length === 0) return;
  const text = problems.map((p) => `  - ${p}`).join("\n");
  if (prod) {
    console.error(`[security] Refusing to start in production:\n${text}`);
    process.exit(1);
  }
  console.warn(`[security] ${local ? "Local run" : "Development"} warnings (these block a real production start):
${text}`);
}

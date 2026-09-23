import { env } from "@/lib/env";

/**
 * Firebase Cloud Messaging delivery (A65). Inactive until FIREBASE_SERVICE_ACCOUNT is configured -
 * `pushEnabled()` returns false and `sendPush()` is a no-op, so everything works without push.
 *
 * Uses the FCM HTTP v1 API with a service-account JWT; no Firebase SDK dependency.
 */
interface ServiceAccount { project_id: string; client_email: string; private_key: string }

function account(): ServiceAccount | null {
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const a = JSON.parse(json) as ServiceAccount;
    return a.project_id && a.client_email && a.private_key ? a : null;
  } catch { return null; }
}

export const pushEnabled = () => account() !== null;

let cached: { token: string; exp: number } | null = null;
async function accessToken(a: ServiceAccount): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const claim = { iss: a.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const jwt = `${unsigned}.${signer.sign(a.private_key.replace(/\\n/g, "\n"), "base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  if (!res.ok) throw new Error(`FCM token request failed: ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: body.access_token, exp: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

export interface PushMessage { title: string; body?: string | null; link?: string | null; type?: string }

/** Sends to every token; returns the tokens FCM rejected so the caller can delete them. */
export async function sendPush(tokens: string[], msg: PushMessage): Promise<{ sent: number; invalid: string[] }> {
  const a = account();
  if (!a || tokens.length === 0) return { sent: 0, invalid: [] };
  let token: string;
  try { token = await accessToken(a); } catch { return { sent: 0, invalid: [] }; }
  const url = `https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`;
  const invalid: string[] = [];
  let sent = 0;
  await Promise.all(tokens.map(async (t) => {
    const payload = {
      message: {
        token: t,
        notification: { title: msg.title, body: msg.body ?? undefined },
        data: { link: msg.link ?? "", type: msg.type ?? "" },
        android: { priority: "HIGH", notification: { channel_id: "workpulse" } },
        apns: { payload: { aps: { sound: "default" } } },
      },
    };
    try {
      const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(payload) });
      if (res.ok) sent++;
      else if (res.status === 404 || res.status === 400) invalid.push(t); // unregistered / malformed token
    } catch { /* transient network error: keep the token */ }
  }));
  return { sent, invalid };
}

/** Session cookie name must match what Auth.js uses so middleware and Socket.IO can read it. */
export function sessionCookieName(): string {
  const secure = (process.env.APP_URL ?? "").startsWith("https://");
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export function parseCookieHeader(header: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

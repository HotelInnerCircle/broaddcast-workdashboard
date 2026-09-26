import { Suspense } from "react";
import { cookies } from "next/headers";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";
import { sessionCookieName } from "@/lib/auth/cookies";
import { revokedInfo, REVOKED_ELSEWHERE } from "@/lib/auth/session-service";
import { connectDB } from "@/lib/db/connect";
import { sinceLabel } from "@/lib/auth/device";

export const metadata = { title: "Sign in" };

/**
 * Why the person is looking at this screen.
 *
 * Somebody whose phone session ended because they signed in on another phone
 * gets dropped here by the middleware with no explanation, which reads as the
 * app having broken. The revoked session row is still there, so it can say what
 * actually happened. Returns null for every ordinary visit.
 */
async function signedOutNotice(): Promise<string | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token) return null;
  try {
    await connectDB();
    const info = await revokedInfo(token);
    if (info?.reason !== REVOKED_ELSEWHERE) return null;
    const where = info.deviceLabel ? ` on ${info.deviceLabel}` : "";
    return `You were signed out because this account was used${where} ${sinceLabel(info.at)}. Only one phone can be signed in at a time.`;
  } catch {
    // The login page must render even when the database is unreachable.
    return null;
  }
}

export default async function LoginPage() {
  const notice = await signedOutNotice();
  return (
    <AuthCard title="Welcome back" subtitle="Sign in to your workspace." footer={<>Need a workspace? Companies are created by the platform administrator - ask them for an invitation.</>}>
      {notice && (
        <p role="status" className="mb-4 rounded-xl bg-warning-soft px-4 py-3 text-[13px] leading-relaxed text-tile-warning-fg">
          {notice}
        </p>
      )}
      <Suspense><LoginForm /></Suspense>
    </AuthCard>
  );
}

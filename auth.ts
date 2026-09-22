import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";
import { z } from "zod";
import { env } from "@/lib/env";
import { connectDB } from "@/lib/db/connect";
import { User } from "@/models/User";
import { Company } from "@/models/Company";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, deleteSession, resolveSession, SESSION_MAX_AGE_SEC } from "@/lib/auth/session-service";
import { sessionCookieName } from "@/lib/auth/cookies";

/**
 * Auth.js v5 with the Credentials provider and DATABASE sessions (spec 3.2).
 * Auth.js refuses `strategy: "database"` for credentials-only setups, so the
 * jwt encode/decode hooks are replaced: the cookie holds only an opaque session
 * token, and every request resolves it against the `sessions` collection.
 * No JWT is ever issued. See ASSUMPTIONS.md (A1).
 */
export class InvalidCredentialsError extends CredentialsSignin { code = "invalid_credentials"; }
export class CompanySuspendedError extends CredentialsSignin { code = "company_suspended"; }
export class AccountInactiveError extends CredentialsSignin { code = "account_inactive"; }

const credentialsSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: env.AUTH_SECRET,
  trustHost: true,
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SEC },
  pages: { signIn: "/login" },
  logger: {
    // A revoked/expired session token decodes to null, which Auth.js reports as "Invalid JWT";
    // failed credential attempts are user errors, not server errors. Everything else is logged.
    error(error) {
      if (error.name === "JWTSessionError" || error instanceof CredentialsSignin) return;
      console.error("[auth]", error);
    },
    warn(code) { console.warn("[auth]", code); },
    debug() {},
  },
  cookies: {
    sessionToken: {
      name: sessionCookieName(),
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: env.APP_URL.startsWith("https://") },
    },
  },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidCredentialsError();
        await connectDB();
        const user = await User.findOne({ email: parsed.data.email.toLowerCase() }).select("+passwordHash").lean();
        if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) throw new InvalidCredentialsError();
        if (user.status !== "active" || user.archivedAt) throw new AccountInactiveError();
        if (user.role !== "SUPER_ADMIN") {
          const company = user.companyId ? await Company.findById(user.companyId).select("status").lean() : null;
          if (!company || company.status !== "active") throw new CompanySuspendedError();
        }
        return { id: String(user._id), email: user.email, name: user.name, role: user.role, companyId: user.companyId ? String(user.companyId) : null };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        let userAgent: string | null = null;
        let ip: string | null = null;
        try {
          const h = await headers();
          userAgent = h.get("user-agent");
          ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
        } catch { /* not in a request scope */ }
        await connectDB();
        const sid = await createSession(user.id, user.companyId ?? null, { userAgent, ip });
        return { sub: user.id, sid };
      }
      return token;
    },
    async session({ session, token }) {
      if (token.ctx) session.user = { ...session.user, ...token.ctx, id: token.ctx.userId };
      return session;
    },
  },
  jwt: {
    async encode({ token }) {
      return (token?.sid as string | undefined) ?? "";
    },
    async decode({ token }) {
      if (!token) return null;
      await connectDB();
      const ctx = await resolveSession(token);
      if (!ctx) return null;
      return { sub: ctx.userId, sid: token, ctx };
    },
  },
  events: {
    async signOut(message) {
      const sid = "token" in message ? (message.token?.sid as string | undefined) : undefined;
      if (sid) { await connectDB(); await deleteSession(sid); }
    },
  },
});

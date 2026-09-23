import { Types } from "mongoose";
import { Session } from "@/models/Session";
import { User } from "@/models/User";
import { Company } from "@/models/Company";
import { generateToken } from "@/lib/utils/tokens";
import type { Role, SessionContext } from "@/types";

export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export async function createSession(userId: string, companyId: string | null, meta: { userAgent?: string | null; ip?: string | null } = {}) {
  const token = generateToken(32);
  await Session.create({
    token,
    userId: new Types.ObjectId(userId),
    companyId: companyId ? new Types.ObjectId(companyId) : null,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000),
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });
  return token;
}

/**
 * Resolve a cookie token to a full context. Returns null when the session is missing/expired,
 * the user is not active, or the company is suspended - so revocation is immediate (spec 3.2).
 */
export async function resolveSession(token: string | null | undefined): Promise<SessionContext | null> {
  if (!token) return null;
  const session = await Session.findOne({ token }).lean();
  if (!session || session.expiresAt.getTime() < Date.now()) return null;

  const user = await User.findById(session.userId).lean();
  if (!user || user.status !== "active" || user.archivedAt) return null;

  let company: SessionContext["company"] = null;
  if (user.role !== "SUPER_ADMIN") {
    if (!user.companyId) return null;
    const c = await Company.findById(user.companyId).lean();
    if (!c || c.status !== "active") return null;
    company = {
      id: String(c._id), name: c.name, logoUrl: c.logoUrl ?? null, timezone: c.timezone,
      currency: c.currency, setupCompleted: c.setupCompleted,
      hiddenNav: ((c.hiddenNav as Record<string, string[]> | undefined)?.[user.role] ?? []),
    };
  }

  const lastSeen = session.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - lastSeen > TOUCH_INTERVAL_MS) {
    const now = new Date();
    void Session.updateOne(
      { _id: session._id },
      { $set: { lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SEC * 1000) } },
    ).catch(() => {});
    void User.updateOne({ _id: user._id }, { $set: { lastActiveAt: now } }).catch(() => {});
  }

  return {
    sessionId: String(session._id),
    userId: String(user._id),
    companyId: user.companyId ? String(user.companyId) : null,
    role: user.role as Role,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl ?? null,
    teamId: user.teamId ? String(user.teamId) : null,
    managerId: user.managerId ? String(user.managerId) : null,
    company,
  };
}

export async function deleteSession(token: string) {
  await Session.deleteOne({ token });
}

/** Called on role change, deactivation, password reset (spec 3.2). */
export async function invalidateUserSessions(userId: string | Types.ObjectId, exceptSessionId?: string) {
  const filter: Record<string, unknown> = { userId: new Types.ObjectId(String(userId)) };
  if (exceptSessionId) filter._id = { $ne: new Types.ObjectId(exceptSessionId) };
  await Session.deleteMany(filter);
}

/** Called on company suspension: every user of the company is signed out at once. */
export async function invalidateCompanySessions(companyId: string | Types.ObjectId) {
  await Session.deleteMany({ companyId: new Types.ObjectId(String(companyId)) });
}

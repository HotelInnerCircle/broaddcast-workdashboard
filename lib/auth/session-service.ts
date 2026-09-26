import { Types } from "mongoose";
import { Session } from "@/models/Session";
import { User } from "@/models/User";
import { Company } from "@/models/Company";
import { generateToken } from "@/lib/utils/tokens";
import { describeDevice } from "@/lib/auth/device";
import type { Role, SessionContext } from "@/types";

export const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Why a session ended, for telling the device that lost it. */
export const REVOKED_ELSEWHERE = "signed_in_elsewhere";

/**
 * Start a session, and - on a phone - end whatever phone session came before it.
 *
 * One person, one phone at a time (A101). The newest sign-in wins: the older
 * phone is marked revoked and is signed out on its very next request, because
 * every request resolves the session row. Desktops and browser tabs are left
 * alone, so HR can have the desktop app open while their phone is in their
 * pocket - the thing being prevented is one login being passed around so
 * somebody else can swipe attendance.
 *
 * Revoking rather than deleting is deliberate: the row is what lets the old
 * device be told it was signed out elsewhere instead of being dropped at a login
 * screen with no explanation. The TTL index clears these rows out in time.
 */
export async function createSession(userId: string, companyId: string | null, meta: { userAgent?: string | null; ip?: string | null } = {}) {
  const token = generateToken(32);
  const device = describeDevice(meta.userAgent);
  const uid = new Types.ObjectId(userId);

  if (device.kind === "mobile") {
    await Session.updateMany(
      { userId: uid, deviceKind: "mobile", revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: REVOKED_ELSEWHERE } },
    );
  }

  await Session.create({
    token,
    userId: uid,
    companyId: companyId ? new Types.ObjectId(companyId) : null,
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SEC * 1000),
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
    deviceKind: device.kind,
    deviceLabel: device.label,
  });
  return token;
}

/**
 * Why a token stopped working, for the login screen to explain.
 *
 * Deliberately says nothing about who or where: this is read with an expired
 * cookie and no session, so it must not become a way to ask questions about
 * somebody else's account.
 */
export async function revokedInfo(token: string | null | undefined): Promise<{ reason: string; deviceLabel: string | null; at: Date } | null> {
  if (!token) return null;
  const s = await Session.findOne({ token, revokedAt: { $ne: null } }).select("revokedAt revokedReason deviceLabel").lean();
  if (!s?.revokedAt) return null;
  return { reason: s.revokedReason ?? "revoked", deviceLabel: s.deviceLabel ?? null, at: s.revokedAt };
}

/** Every live session for a person, newest first - for "where am I signed in?". */
export async function listUserSessions(userId: string | Types.ObjectId) {
  const rows = await Session.find({ userId: new Types.ObjectId(String(userId)), revokedAt: null, expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1 }).select("deviceKind deviceLabel lastSeenAt ip createdAt").lean();
  return rows.map((r) => ({
    id: String(r._id),
    deviceKind: r.deviceKind as string,
    deviceLabel: r.deviceLabel ?? "An unknown device",
    lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    signedInAt: (r as unknown as { createdAt?: Date }).createdAt?.toISOString() ?? null,
  }));
}

/**
 * Resolve a cookie token to a full context. Returns null when the session is missing/expired,
 * the user is not active, or the company is suspended - so revocation is immediate (spec 3.2).
 */
export async function resolveSession(token: string | null | undefined): Promise<SessionContext | null> {
  if (!token) return null;
  const session = await Session.findOne({ token }).lean();
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  // Signed in somewhere else since: the row is kept so the login screen can say
  // so, but it stops authorising anything from this moment on.
  if (session.revokedAt) return null;

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
      // So a screen can mark the picture required before the server refuses it.
      workProof: {
        timer: (c.workProof as { timer?: boolean } | undefined)?.timer !== false,
        dailyReport: (c.workProof as { dailyReport?: boolean } | undefined)?.dailyReport !== false,
      },
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

import { Types } from "mongoose";
import { Company } from "@/models/Company";
import { User } from "@/models/User";
import { Plan } from "@/models/Plan";
import { PasswordResetToken } from "@/models/PasswordResetToken";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { invalidateUserSessions } from "@/lib/auth/session-service";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/api/errors";
import { sendMail } from "@/lib/email";
import { passwordResetEmail } from "@/lib/email/templates";
import { env } from "@/lib/env";
import { generateToken, hashToken, slugify } from "@/lib/utils/tokens";

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour (spec 6.4)

/** Always resolves successfully so the UI never reveals whether an email exists (spec 6.4). */
export async function requestPasswordReset(email: string) {
  const user = await User.findOne({ email, status: "active", archivedAt: null }).select("_id name email").lean();
  if (!user) return;
  const token = generateToken(32);
  await PasswordResetToken.create({ userId: user._id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  const link = `${env.APP_URL}/reset-password?token=${token}`;
  await sendMail({ to: user.email, ...passwordResetEmail({ name: user.name, link }) });
}

export async function resetPassword(token: string, newPassword: string) {
  const rec = await PasswordResetToken.findOne({ tokenHash: hashToken(token) });
  if (!rec || rec.usedAt || rec.expiresAt.getTime() < Date.now()) {
    throw Errors.bad("INVALID_TOKEN", "This reset link is invalid or has expired");
  }
  const user = await User.findById(rec.userId).select("_id name role companyId status");
  if (!user || user.status !== "active") throw Errors.bad("INVALID_TOKEN", "This reset link is invalid or has expired");

  await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(newPassword) } });
  rec.usedAt = new Date();
  await rec.save();
  await invalidateUserSessions(user._id);
  await audit({ ctx: { userId: String(user._id), role: user.role, name: user.name }, companyId: user.companyId ?? null, entity: "user", entityId: user._id, action: "user.password_reset", summary: `${user.name} reset their password` });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, keepSessionId: string) {
  const user = await User.findById(new Types.ObjectId(userId)).select("+passwordHash name role companyId");
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw Errors.bad("WRONG_PASSWORD", "Your current password is incorrect");
  }
  await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(newPassword) } });
  await invalidateUserSessions(user._id, keepSessionId);
  await audit({ ctx: { userId, role: user.role, name: user.name }, companyId: user.companyId ?? null, entity: "user", entityId: user._id, action: "user.password_changed", summary: `${user.name} changed their password` });
}

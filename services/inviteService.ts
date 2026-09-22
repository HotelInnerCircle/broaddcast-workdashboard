import { Types } from "mongoose";
import { scoped, unscopedOptions, pop } from "@/lib/db/scoped";
import { Invite } from "@/models/Invite";
import { User } from "@/models/User";
import { Team } from "@/models/Team";
import { Company } from "@/models/Company";
import { audit } from "@/lib/audit";
import { Errors } from "@/lib/api/errors";
import { checkLimit } from "@/lib/limits";
import { sendMail } from "@/lib/email";
import { inviteEmail } from "@/lib/email/templates";
import { env } from "@/lib/env";
import { hashPassword } from "@/lib/auth/password";
import { generateToken, hashToken } from "@/lib/utils/tokens";
import { ROLE_LABEL } from "@/types";
import type { CompanyContext } from "@/lib/auth/context";
import type { CreateInviteInput, CreateEmployeeInput } from "@/lib/validation/employees";
import { manageableTeamIds } from "./scope";

const INVITE_TTL_DAYS = 7; // spec 6.2

const oid = (v: string | null | undefined) => (v ? new Types.ObjectId(v) : null);

async function issueToken(inviteId: Types.ObjectId, ctx: CompanyContext) {
  const token = generateToken(32);
  await scoped(Invite, ctx).updateOne(
    { _id: inviteId },
    { $set: { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000), lastSentAt: new Date() } },
  );
  return token;
}

async function deliver(ctx: CompanyContext, email: string, role: string, token: string) {
  const company = await Company.findById(ctx.companyId).select("name").lean();
  const link = `${env.APP_URL}/invite/${token}`;
  await sendMail({ to: email, ...inviteEmail({ companyName: company?.name ?? "your company", inviterName: ctx.name, role: ROLE_LABEL[role as keyof typeof ROLE_LABEL], link, expiresInDays: INVITE_TTL_DAYS }) });
}

/** Placement rules shared by invites and direct creation: Admin any role/team; Manager only TEAM_LEAD/EMPLOYEE into own teams. */
async function validatePlacement(ctx: CompanyContext, input: CreateInviteInput) {
  if (ctx.role === "MANAGER" && !["TEAM_LEAD", "EMPLOYEE"].includes(input.role)) {
    throw Errors.forbidden("Managers can only add team leads and employees");
  }
  const allowedTeams = await manageableTeamIds(ctx);
  if (input.teamId) {
    const team = await scoped(Team, ctx).findById(input.teamId).select("_id").lean();
    if (!team) throw Errors.notFound("Team");
    if (allowedTeams !== "all" && !allowedTeams.some((t) => t.equals(team._id))) throw Errors.forbidden("You can only add people into teams you manage");
  } else if (ctx.role === "MANAGER") {
    throw Errors.bad("TEAM_REQUIRED", "Select one of your teams");
  }
  if (await User.exists({ email: input.email })) throw Errors.conflict("EMAIL_TAKEN", "A user with this email already exists");
  await checkLimit(ctx.companyId, "users");
  return { managerId: ctx.role === "MANAGER" ? new Types.ObjectId(ctx.userId) : oid(input.managerId) };
}

/**
 * Direct creation (A56): the account is active immediately with the password the admin typed; the
 * admin hands the credentials over. Same placement rules, plan limit and audit as an invite.
 */
export async function createEmployee(ctx: CompanyContext, input: CreateEmployeeInput, ip: string | null) {
  const { managerId } = await validatePlacement(ctx, input);
  const user = await scoped(User, ctx).create({
    name: input.name, email: input.email, role: input.role, teamId: oid(input.teamId), managerId, designation: input.designation ?? null,
    passwordHash: await hashPassword(input.password), status: "active", joiningDate: new Date(),
  });
  await audit({ ctx, companyId: ctx.companyId, entity: "user", entityId: user._id, action: "user.created", summary: `${ctx.name} created an account for ${input.name} (${ROLE_LABEL[input.role]})`, after: { email: input.email, role: input.role, teamId: input.teamId ?? null, method: "direct" }, ip });
  return { id: String(user._id), name: user.name, email: user.email, role: user.role };
}

/** Admin (any role/team) or Manager (TEAM_LEAD/EMPLOYEE, own teams only) invites by email (spec 6.2). */
export async function createInvite(ctx: CompanyContext, input: CreateInviteInput, ip: string | null) {
  const { managerId } = await validatePlacement(ctx, input);
  const user = await scoped(User, ctx).create({
    name: input.email.split("@")[0], email: input.email, role: input.role, teamId: oid(input.teamId),
    managerId, designation: input.designation ?? null, status: "invited",
  });
  const invite = await scoped(Invite, ctx).create({
    email: input.email, role: input.role, teamId: oid(input.teamId), managerId, userId: user._id,
    invitedBy: new Types.ObjectId(ctx.userId), tokenHash: "pending", expiresAt: new Date(),
  });
  const token = await issueToken(invite._id, ctx);
  await deliver(ctx, input.email, input.role, token);
  await audit({ ctx, companyId: ctx.companyId, entity: "user", entityId: user._id, action: "user.invited", summary: `${ctx.name} invited ${input.email} as ${ROLE_LABEL[input.role]}`, after: { email: input.email, role: input.role, teamId: input.teamId ?? null }, ip });
  return { inviteId: String(invite._id), userId: String(user._id) };
}

export async function resendInvite(ctx: CompanyContext, inviteId: string, ip: string | null) {
  const invite = await scoped(Invite, ctx).findById(inviteId);
  if (!invite || invite.status !== "pending") throw Errors.notFound("Invite");
  const token = await issueToken(invite._id, ctx);
  await deliver(ctx, invite.email, invite.role, token);
  await audit({ ctx, companyId: ctx.companyId, entity: "invite", entityId: invite._id, action: "invite.resent", summary: `Invite to ${invite.email} resent`, ip });
}

export async function revokeInvite(ctx: CompanyContext, inviteId: string, ip: string | null) {
  const invite = await scoped(Invite, ctx).findById(inviteId);
  if (!invite || invite.status !== "pending") throw Errors.notFound("Invite");
  invite.status = "revoked";
  invite.revokedAt = new Date();
  await invite.save();
  await scoped(User, ctx).updateOne({ _id: invite.userId, status: "invited" }, { $set: { status: "deactivated", archivedAt: new Date() } });
  await audit({ ctx, companyId: ctx.companyId, entity: "invite", entityId: invite._id, action: "invite.revoked", summary: `Invite to ${invite.email} revoked`, ip });
}

/** Public: used by /invite/[token] to show who is being invited where. */
export async function getInviteByToken(token: string) {
  const invite = await Invite.findOne({ tokenHash: hashToken(token) }).setOptions(unscopedOptions).lean();
  if (!invite || invite.status !== "pending" || invite.expiresAt.getTime() < Date.now()) return null;
  const company = await Company.findById(invite.companyId).select("name logoUrl status").lean();
  if (!company || company.status !== "active") return null;
  return { id: String(invite._id), email: invite.email, role: invite.role, companyName: company.name, companyLogoUrl: company.logoUrl ?? null, expiresAt: invite.expiresAt };
}

/** Public: the invitee sets name + password and the account becomes active (spec 6.2). */
export async function acceptInvite(token: string, name: string, password: string, ip: string | null) {
  const invite = await Invite.findOne({ tokenHash: hashToken(token) }).setOptions(unscopedOptions);
  if (!invite || invite.status !== "pending" || invite.expiresAt.getTime() < Date.now()) {
    throw Errors.bad("INVALID_INVITE", "This invitation is invalid, expired or has been revoked");
  }
  const company = await Company.findById(invite.companyId).select("status").lean();
  if (!company || company.status !== "active") throw Errors.bad("INVALID_INVITE", "This invitation is no longer available");
  const tenant = { companyId: new Types.ObjectId(String(invite.companyId)) };
  const user = await scoped(User, tenant).findOneAndUpdate(
    { _id: invite.userId, status: "invited" },
    { $set: { name, passwordHash: await hashPassword(password), status: "active", joiningDate: new Date() } },
  );
  if (!user) throw Errors.bad("INVALID_INVITE", "This invitation is invalid, expired or has been revoked");
  invite.status = "accepted";
  invite.acceptedAt = new Date();
  await invite.save();
  await audit({ ctx: { userId: String(user._id), role: user.role, name }, companyId: tenant.companyId, entity: "user", entityId: user._id, action: "user.created", summary: `${name} accepted their invitation`, after: { email: user.email, role: user.role }, ip });
  return { email: user.email };
}

export async function listPendingInvites(ctx: CompanyContext) {
  const filter: Record<string, unknown> = { status: "pending" };
  if (ctx.role === "MANAGER") filter.invitedBy = new Types.ObjectId(ctx.userId);
  const invites = await scoped(Invite, ctx).find(filter).sort({ createdAt: -1 }).populate(pop("teamId", "name")).lean();
  return invites.map((i) => ({
    id: String(i._id), email: i.email, role: i.role,
    team: i.teamId && typeof i.teamId === "object" && "name" in i.teamId ? (i.teamId as { name: string }).name : null,
    expiresAt: i.expiresAt, lastSentAt: i.lastSentAt, createdAt: i.createdAt,
  }));
}

import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { storage } from "@/lib/storage";
import { User } from "@/models/User";
import { Team } from "@/models/Team";
import { Company } from "@/models/Company";
import { AttendanceSwipe } from "@/models/AttendanceSwipe";
import { LeaveRequest } from "@/models/LeaveRequest";
import { LEAVE_TYPE_LABEL, ROLE_LABEL, type LeaveType, type Role } from "@/types";
import type { CompanyContext } from "@/lib/auth/context";

export interface ProfileDto {
  id: string; name: string; email: string; role: Role; roleLabel: string;
  avatarUrl: string | null; phone: string | null;
  gender: string | null; maritalStatus: string | null; dateOfBirth: string | null;
  joiningDate: string | null;
  companyName: string | null; designation: string | null; department: string | null; branch: string | null;
  teamName: string | null; managerName: string | null;
  address: string | null;
  emergencyContact: { name: string | null; relation: string | null; phone: string | null };
  updateRequest: string | null; updateRequestAt: string | null;
}

/** One person's profile, with the employment facts resolved to names rather than ids. */
export async function getProfile(ctx: CompanyContext, userId?: string): Promise<ProfileDto> {
  const id = userId ?? ctx.userId;
  const u = await scoped(User, ctx).findById(id).lean();
  if (!u) throw Errors.notFound("Profile");

  const [company, team, manager] = await Promise.all([
    ctx.companyId ? Company.findById(ctx.companyId).select("name").lean() : null,
    u.teamId ? scoped(Team, ctx).findById(String(u.teamId)).select("name").lean() : null,
    u.managerId ? scoped(User, ctx).findById(String(u.managerId)).select("name").lean() : null,
  ]);
  const day = (d: unknown) => (d ? new Date(d as string | Date).toISOString().slice(0, 10) : null);
  const ec = (u.emergencyContact ?? {}) as { name?: string; relation?: string; phone?: string };

  return {
    id: String(u._id),
    name: u.name as string,
    email: u.email as string,
    role: u.role as Role,
    roleLabel: ROLE_LABEL[u.role as Role],
    avatarUrl: (u.avatarUrl as string | null) ?? null,
    phone: (u.phone as string | null) ?? null,
    gender: (u.gender as string | null) ?? null,
    maritalStatus: (u.maritalStatus as string | null) ?? null,
    dateOfBirth: day(u.dateOfBirth),
    joiningDate: day(u.joiningDate) ?? day(u.createdAt),
    companyName: (company?.name as string | undefined) ?? null,
    designation: (u.designation as string | null) ?? null,
    department: (u.department as string | null) ?? null,
    branch: (u.branch as string | null) ?? null,
    teamName: (team?.name as string | undefined) ?? null,
    managerName: (manager?.name as string | undefined) ?? null,
    address: (u.address as string | null) ?? null,
    emergencyContact: { name: ec.name ?? null, relation: ec.relation ?? null, phone: ec.phone ?? null },
    updateRequest: (u.updateRequest as string | null) ?? null,
    updateRequestAt: u.updateRequestAt ? new Date(u.updateRequestAt as unknown as string).toISOString() : null,
  };
}

export interface ReportingItem { userId: string; userName: string; kind: "Swipes" | "Leave Request"; count: number; href: string }

/**
 * The reporting list (A93): what is sitting on this person's desk, by whose it is.
 *
 * Only what is genuinely waiting on *them* - the step the request has actually reached - so the
 * list is a to-do rather than a feed of everything happening below them.
 */
export async function reportingList(ctx: CompanyContext): Promise<ReportingItem[]> {
  if (ctx.role === "EMPLOYEE") return [];
  const me = new Types.ObjectId(ctx.userId);
  const settles = ctx.role === "HR" || ctx.role === "COMPANY_ADMIN";
  // Typed loosely on purpose: a dotted path into an array of subdocuments is beyond what the
  // generated query type can express, and narrowing it here would be a cast either way.
  const waiting: Record<string, unknown> = settles
    ? { $or: [{ "approvals.approverId": me }, { "approvals.step": "HR" }] }
    : { "approvals.approverId": me };

  const [swipes, leave] = await Promise.all([
    scoped(AttendanceSwipe, ctx).find({ status: "PENDING", ...waiting } as never).select("userId").lean(),
    scoped(LeaveRequest, ctx).find({ status: "PENDING", ...waiting } as never).select("userId type").lean(),
  ]);

  const ids = [...new Set([...swipes, ...leave].map((r) => String(r.userId)))];
  if (!ids.length) return [];
  const people = await scoped(User, ctx).find({ _id: { $in: ids.map((i) => new Types.ObjectId(i)) } }).select("name").lean();
  const names = new Map(people.map((p) => [String(p._id), p.name as string]));

  const out: ReportingItem[] = [];
  const tally = (rows: Array<{ userId: unknown }>, kind: ReportingItem["kind"], href: string) => {
    const by = new Map<string, number>();
    for (const r of rows) by.set(String(r.userId), (by.get(String(r.userId)) ?? 0) + 1);
    for (const [uid, count] of by) out.push({ userId: uid, userName: names.get(uid) ?? "Unknown", kind, count, href });
  };
  tally(swipes, "Swipes", "/attendance/swipes");
  tally(leave, "Leave Request", "/leave");
  return out;
}

/** Replaces the avatar, removing the old object so a company's storage does not grow forever. */
export async function setAvatar(ctx: CompanyContext, buffer: Buffer, mime: string, ext: string): Promise<string> {
  const u = await scoped(User, ctx).findById(ctx.userId);
  if (!u) throw Errors.notFound("Profile");
  const key = `companies/${ctx.companyId}/avatars/${ctx.userId}-${Date.now()}.${ext}`;
  await storage().put({ key, body: buffer, contentType: mime });
  const url = await storage().getSignedUrl(key, 60 * 60 * 24 * 365);
  const old = u.avatarKey as string | null | undefined;
  u.set("avatarKey", key);
  u.set("avatarUrl", url);
  await u.save();
  if (old) await storage().delete(old).catch(() => { /* an orphan is better than a failed upload */ });
  return url;
}

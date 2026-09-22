import { Types } from "mongoose";
import { Company } from "@/models/Company";
import { User } from "@/models/User";
import { Plan } from "@/models/Plan";
import { Errors } from "@/lib/api/errors";
import { pop } from "@/lib/db/scoped";
import { audit } from "@/lib/audit";
import { invalidateCompanySessions } from "@/lib/auth/session-service";
import type { SessionContext } from "@/types";
import { AuditLog } from "@/models/AuditLog";
import { escapeRegex } from "@/lib/utils/regex";
import { Subscription } from "@/models/Subscription";
import { applyPlan } from "./billingService";
import { planUsage } from "@/lib/limits";
import type { Model } from "mongoose";
import { scoped, unscopedOptions } from "@/lib/db/scoped";
import { Invite } from "@/models/Invite";
import { Session } from "@/models/Session";
import { Team } from "@/models/Team";
import { Client } from "@/models/Client";
import { Project } from "@/models/Project";
import { Task } from "@/models/Task";
import { TaskComment } from "@/models/TaskComment";
import { TimeEntry } from "@/models/TimeEntry";
import { Break } from "@/models/Break";
import { Attendance } from "@/models/Attendance";
import { DailyReport } from "@/models/DailyReport";
import { Conversation } from "@/models/Conversation";
import { Message } from "@/models/Message";
import { Notification } from "@/models/Notification";
import { Announcement } from "@/models/Announcement";
import { Invoice } from "@/models/Invoice";
import { PasswordResetToken } from "@/models/PasswordResetToken";
import { storage } from "@/lib/storage";
import { sendMail } from "@/lib/email";
import { inviteEmail } from "@/lib/email/templates";
import { env } from "@/lib/env";
import { generateToken, hashToken, slugify } from "@/lib/utils/tokens";
import { hashPassword } from "@/lib/auth/password";
import { ROLE_LABEL } from "@/types";
import type { CreateCompanyInput } from "@/lib/validation/company";

/** Every collection that belongs to a tenant, deleted together with the company (A55). Users/sessions are keyed by companyId too. */
const TENANT_MODELS = { users: User, sessions: Session, invites: Invite, teams: Team, clients: Client, projects: Project, tasks: Task, taskComments: TaskComment, timeEntries: TimeEntry, breaks: Break, attendance: Attendance, dailyReports: DailyReport, conversations: Conversation, messages: Message, notifications: Notification, announcements: Announcement, subscriptions: Subscription, invoices: Invoice };

/** Every super-admin cross-tenant read is audited (spec 4.6). */
export async function listCompanies(ctx: SessionContext, ip: string | null) {
  const companies = await Company.find().sort({ createdAt: -1 }).populate(pop("planId", "name")).lean();
  const counts = await User.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { companyId: { $ne: null }, archivedAt: null, status: { $ne: "deactivated" } } },
    { $group: { _id: "$companyId", n: { $sum: 1 } } },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c.n]));
  await audit({ ctx, companyId: null, entity: "company", action: "superadmin.companies_listed", summary: `${ctx.name} listed all companies`, crossTenant: true, ip });
  return companies.map((c) => ({
    id: String(c._id), name: c.name, slug: c.slug, status: c.status, createdAt: c.createdAt,
    users: map.get(String(c._id)) ?? 0, plan: c.planId && typeof c.planId === "object" && "name" in c.planId ? (c.planId as { name: string }).name : null,
    planId: c.planId ? String((c.planId as { _id?: unknown })._id ?? c.planId) : null,
  }));
}

export async function platformStats(ctx: SessionContext, ip: string | null) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const activeSince = new Date(Date.now() - 86_400_000);
  const [companies, activeCompanies, users, activeUsers, newCompanies, plans] = await Promise.all([
    Company.countDocuments(), Company.countDocuments({ status: "active" }),
    User.countDocuments({ role: { $ne: "SUPER_ADMIN" }, archivedAt: null }),
    User.countDocuments({ role: { $ne: "SUPER_ADMIN" }, lastActiveAt: { $gte: activeSince } }),
    Company.countDocuments({ createdAt: { $gte: since } }),
    Plan.find().lean(),
  ]);
  const planMap = new Map(plans.map((p) => [String(p._id), p]));
  const paid = await Company.find({ status: "active", planId: { $ne: null } }).select("planId").lean();
  const mrr = paid.reduce((sum, c) => sum + (planMap.get(String(c.planId))?.price ?? 0), 0);
  await audit({ ctx, companyId: null, entity: "platform", action: "superadmin.stats_viewed", summary: `${ctx.name} viewed platform analytics`, crossTenant: true, ip });
  return { companies, activeCompanies, users, activeUsers, newCompanies, mrr, subscriptions: paid.length, plans: plans.map((p) => ({ id: String(p._id), name: p.name, price: p.price, limits: p.limits })) };
}

export async function patchCompany(ctx: SessionContext, companyId: string, input: { status?: "active" | "suspended"; planId?: string; reason?: string }, ip: string | null) {
  const company = Types.ObjectId.isValid(companyId) ? await Company.findById(companyId) : null;
  if (!company) throw Errors.notFound("Company");
  const before = { status: company.status, planId: company.planId };
  if (input.planId !== undefined) {
    const plan = await Plan.findById(input.planId).lean();
    if (!plan) throw Errors.notFound("Plan");
    company.planId = plan._id;
    await applyPlan(company._id, plan._id, { cycle: "monthly", provider: "manual", payment: { orderId: null, paymentId: null, amount: 0, currency: plan.currency ?? "INR", note: `Assigned by ${ctx.name}` } });
    await audit({ ctx, companyId: company._id, entity: "company", entityId: company._id, action: "plan.changed", summary: `${ctx.name} changed plan of "${company.name}" to ${plan.name}`, before, after: { planId: plan._id }, crossTenant: true, ip });
  }
  if (input.status !== undefined && input.status !== company.status) {
    company.status = input.status;
    company.suspendedAt = input.status === "suspended" ? new Date() : null;
    company.suspendReason = input.status === "suspended" ? (input.reason ?? null) : null;
    if (input.status === "suspended") await invalidateCompanySessions(company._id); // spec 3.2 / 6.5
    await audit({ ctx, companyId: company._id, entity: "company", entityId: company._id, action: input.status === "suspended" ? "company.suspended" : "company.reactivated", summary: `${ctx.name} ${input.status === "suspended" ? "suspended" : "reactivated"} "${company.name}"`, before, after: { status: input.status }, crossTenant: true, ip });
  }
  await company.save();
  return { id: String(company._id), status: company.status, planId: company.planId ? String(company.planId) : null };
}

/** Company detail for the Super Admin: every read is a cross-tenant access and is audited (spec 4.6). */
export async function companyDetail(ctx: SessionContext, companyId: string, ip: string | null) {
  const company = Types.ObjectId.isValid(companyId) ? await Company.findById(companyId).populate({ path: "planId", select: "name price limits" }).lean() : null;
  if (!company) throw Errors.notFound("Company");
  const [users, usage, sub, recent, admins] = await Promise.all([
    User.countDocuments({ companyId: company._id, archivedAt: null, status: { $ne: "deactivated" } }),
    planUsage(company._id),
    Subscription.findOne({ companyId: company._id }).lean(),
    AuditLog.find({ companyId: company._id }).sort({ createdAt: -1 }).limit(15).lean(),
    User.find({ companyId: company._id, role: "COMPANY_ADMIN", archivedAt: null }).select("name email status").lean(),
  ]);
  await audit({ ctx, companyId: company._id, entity: "company", entityId: company._id, action: "superadmin.company_viewed", summary: `${ctx.name} viewed "${company.name}" (cross-tenant read)`, crossTenant: true, ip });
  const plan = company.planId && typeof company.planId === "object" && "name" in company.planId ? (company.planId as unknown as { _id: unknown; name: string; price: number }) : null;
  return {
    id: String(company._id), name: company.name, slug: company.slug, status: company.status, timezone: company.timezone, currency: company.currency, createdAt: company.createdAt, suspendedAt: company.suspendedAt ?? null, suspendReason: company.suspendReason ?? null,
    plan: plan ? { id: String(plan._id), name: plan.name, price: plan.price } : null, planId: plan ? String(plan._id) : null, users, usage,
    subscription: sub ? { status: sub.status, billingCycle: sub.billingCycle, currentPeriodEnd: sub.currentPeriodEnd, provider: sub.provider, payments: sub.payments.length } : null,
    admins: admins.map((a) => ({ id: String(a._id), name: a.name, email: a.email, status: a.status })),
    recentAudit: recent.map((a) => ({ id: String(a._id), action: a.action, summary: a.summary ?? null, actorName: a.actorName ?? null, crossTenant: a.crossTenant, createdAt: a.createdAt })),
  };
}

/** Platform-wide audit viewer (Super Admin). */
export async function platformAudit(ctx: SessionContext, q: { page: number; limit: number; action?: string; companyId?: string; crossTenant?: boolean }, ip: string | null) {
  const filter: Record<string, unknown> = {};
  if (q.action) filter.action = { $regex: escapeRegex(q.action), $options: "i" };
  if (q.companyId && Types.ObjectId.isValid(q.companyId)) filter.companyId = new Types.ObjectId(q.companyId);
  if (q.crossTenant) filter.crossTenant = true;
  const [total, rows, companies] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Company.find().select("name").lean(),
  ]);
  const names = new Map(companies.map((c) => [String(c._id), c.name]));
  await audit({ ctx, companyId: null, entity: "auditLog", action: "superadmin.audit_viewed", summary: `${ctx.name} viewed the platform audit log`, crossTenant: true, ip });
  return { rows: rows.map((a) => ({ id: String(a._id), company: a.companyId ? names.get(String(a.companyId)) ?? String(a.companyId) : null, entity: a.entity, entityId: a.entityId ?? null, action: a.action, summary: a.summary ?? null, actorName: a.actorName ?? null, actorRole: a.actorRole ?? null, crossTenant: a.crossTenant, createdAt: a.createdAt })), meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)) } };
}

const INVITE_TTL_DAYS = 7; // spec 6.2

/**
 * Only the Super Admin creates companies (A55): the company is created with the default (or given)
 * plan and its first COMPANY_ADMIN is invited by email exactly like any other invite, so the admin
 * chooses their own password. The invite link is returned so it can be handed over when SMTP is
 * not configured.
 */
export async function createCompany(ctx: SessionContext, input: CreateCompanyInput, ip: string | null) {
  if (await User.exists({ email: input.adminEmail })) throw Errors.conflict("EMAIL_TAKEN", "A user with this email already exists");
  const plan = input.planId ? await Plan.findById(input.planId).lean() : await Plan.findOne({ isDefault: true }).lean();
  if (input.planId && !plan) throw Errors.notFound("Plan");

  const base = slugify(input.name);
  let slug = base;
  for (let i = 2; await Company.exists({ slug }); i++) slug = `${base}-${i}`;
  const company = await Company.create({ name: input.name, slug, planId: plan?._id ?? null, ...(input.timezone ? { timezone: input.timezone } : {}) });
  if (plan) await applyPlan(company._id, plan._id, { cycle: "monthly", provider: "manual", payment: { orderId: null, paymentId: null, amount: 0, currency: plan.currency ?? "INR", note: `Assigned by ${ctx.name} at creation` } });

  const tenant = { companyId: String(company._id) };
  if (input.adminPassword) {
    // Direct credentials (A56): active account now; the Super Admin hands the password over.
    const admin = await scoped(User, tenant).create({ name: input.adminName, email: input.adminEmail, role: "COMPANY_ADMIN", status: "active", passwordHash: await hashPassword(input.adminPassword), joiningDate: new Date() });
    await audit({ ctx, companyId: company._id, entity: "company", entityId: company._id, action: "company.created", summary: `${ctx.name} created company "${company.name}"`, after: { name: company.name, slug, planId: plan ? String(plan._id) : null }, crossTenant: true, ip });
    await audit({ ctx, companyId: company._id, entity: "user", entityId: admin._id, action: "user.created", summary: `${ctx.name} created Company Admin ${input.adminEmail} with a password`, after: { email: input.adminEmail, role: "COMPANY_ADMIN", method: "direct" }, crossTenant: true, ip });
    return { id: String(company._id), name: company.name, slug, planId: plan ? String(plan._id) : null, admin: { id: String(admin._id), name: admin.name, email: admin.email }, inviteId: null, inviteLink: null };
  }
  const admin = await scoped(User, tenant).create({ name: input.adminName, email: input.adminEmail, role: "COMPANY_ADMIN", status: "invited" });
  const token = generateToken(32);
  const invite = await scoped(Invite, tenant).create({
    email: input.adminEmail, role: "COMPANY_ADMIN", teamId: null, managerId: null, userId: admin._id,
    invitedBy: new Types.ObjectId(ctx.userId), tokenHash: hashToken(token), expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000), lastSentAt: new Date(),
  });
  const link = `${env.APP_URL}/invite/${token}`;
  await sendMail({ to: input.adminEmail, ...inviteEmail({ companyName: company.name, inviterName: ctx.name, role: ROLE_LABEL.COMPANY_ADMIN, link, expiresInDays: INVITE_TTL_DAYS }) });

  await audit({ ctx, companyId: company._id, entity: "company", entityId: company._id, action: "company.created", summary: `${ctx.name} created company "${company.name}"`, after: { name: company.name, slug, planId: plan ? String(plan._id) : null }, crossTenant: true, ip });
  await audit({ ctx, companyId: company._id, entity: "user", entityId: admin._id, action: "user.invited", summary: `${ctx.name} invited ${input.adminEmail} as Company Admin`, after: { email: input.adminEmail, role: "COMPANY_ADMIN" }, crossTenant: true, ip });
  return { id: String(company._id), name: company.name, slug, planId: plan ? String(plan._id) : null, admin: { id: String(admin._id), name: admin.name, email: admin.email }, inviteId: String(invite._id) as string | null, inviteLink: link as string | null };
}

/**
 * Only the Super Admin deletes a company (A55). Irreversible: every tenant document, every user and
 * session, pending invites, the subscription and the uploaded files are removed. The audit trail is
 * append-only and is kept (it is the only record that the company existed).
 */
export async function deleteCompany(ctx: SessionContext, companyId: string, confirmName: string, ip: string | null) {
  const company = Types.ObjectId.isValid(companyId) ? await Company.findById(companyId).lean() : null;
  if (!company) throw Errors.notFound("Company");
  if (confirmName.trim().toLowerCase() !== company.name.trim().toLowerCase()) throw Errors.bad("CONFIRM_NAME_MISMATCH", "Type the company name exactly to confirm deletion");

  const cid = company._id;
  await invalidateCompanySessions(cid);
  const userIds = (await User.find({ companyId: cid }).select("_id").lean()).map((u) => u._id);
  await PasswordResetToken.deleteMany({ userId: { $in: userIds } });
  const counts: Record<string, number> = {};
  for (const [name, model] of Object.entries(TENANT_MODELS)) {
    const r = await (model as Model<unknown>).deleteMany({ companyId: cid }).setOptions(unscopedOptions);
    counts[name] = r.deletedCount;
  }
  await storage().deletePrefix(`companies/${cid}`).catch(() => { /* best effort: files may already be gone */ });
  await Company.deleteOne({ _id: cid });

  await audit({ ctx, companyId: cid, entity: "company", entityId: cid, action: "company.deleted", summary: `${ctx.name} permanently deleted company "${company.name}"`, before: { name: company.name, slug: company.slug, status: company.status, deleted: counts }, crossTenant: true, ip });
  return { id: String(cid), name: company.name, deleted: counts };
}

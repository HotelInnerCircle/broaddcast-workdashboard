import { Types } from "mongoose";
import { Company } from "@/models/Company";
import { User } from "@/models/User";
import { Team } from "@/models/Team";
import { AuditLog } from "@/models/AuditLog";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { storage } from "@/lib/storage";
import { planUsage } from "@/lib/limits";
import type { CompanyContext } from "@/lib/auth/context";
import type { UpdateCompanyInput } from "@/lib/validation/company";

export function serializeCompany(c: Record<string, unknown>) {
  return {
    id: String(c._id), name: c.name as string, logoUrl: (c.logoUrl as string | null) ?? null, timezone: c.timezone as string,
    currency: c.currency as string, workingHours: c.workingHours as { start: string; end: string }, workingDays: c.workingDays as string[],
    lateThresholdMinutes: c.lateThresholdMinutes as number, defaultTaskStatus: c.defaultTaskStatus as string, designations: ((c.designations as string[] | undefined) ?? []), employeeCodePrefix: ((c.employeeCodePrefix as string | undefined) ?? "EMP"), employeeCodePadding: ((c.employeeCodePadding as number | undefined) ?? 3), payrollStartDay: ((c.payrollStartDay as number | undefined) ?? 1), approvalChain: ((c.approvalChain as string[] | undefined)?.length ? (c.approvalChain as string[]) : ["TEAM_LEAD", "MANAGER", "HR"]), workProof: { timer: (c.workProof as { timer?: boolean } | undefined)?.timer !== false, dailyReport: (c.workProof as { dailyReport?: boolean } | undefined)?.dailyReport !== false }, services: ((c.services as string[] | undefined) ?? []),
    hiddenNav: {
      COMPANY_ADMIN: ((c.hiddenNav as Record<string, string[]> | undefined)?.COMPANY_ADMIN ?? []),
      HR: ((c.hiddenNav as Record<string, string[]> | undefined)?.HR ?? []),
      MANAGER: ((c.hiddenNav as Record<string, string[]> | undefined)?.MANAGER ?? []),
      TEAM_LEAD: ((c.hiddenNav as Record<string, string[]> | undefined)?.TEAM_LEAD ?? []),
      EMPLOYEE: ((c.hiddenNav as Record<string, string[]> | undefined)?.EMPLOYEE ?? []),
    },
    status: c.status as string, setupCompleted: c.setupCompleted as boolean, createdAt: c.createdAt as Date,
  };
}

export async function getCompany(ctx: CompanyContext) {
  const c = await Company.findById(ctx.companyId).lean();
  if (!c) throw Errors.notFound("Company");
  return serializeCompany(c as Record<string, unknown>);
}

export async function updateCompany(ctx: CompanyContext, input: UpdateCompanyInput, ip: string | null) {
  const c = await Company.findById(ctx.companyId);
  if (!c) throw Errors.notFound("Company");
  const before = serializeCompany(c.toObject() as Record<string, unknown>);
  if (input.name !== undefined) c.name = input.name;
  if (input.timezone !== undefined) {
    try { Intl.DateTimeFormat(undefined, { timeZone: input.timezone }); } catch { throw Errors.validation({ timezone: "Unknown timezone" }); }
    c.timezone = input.timezone;
  }
  if (input.currency !== undefined) c.currency = input.currency;
  if (input.workingHours !== undefined) c.workingHours = input.workingHours;
  if (input.workingDays !== undefined) c.set("workingDays", input.workingDays);
  if (input.lateThresholdMinutes !== undefined) c.lateThresholdMinutes = input.lateThresholdMinutes;
  if (input.defaultTaskStatus !== undefined) c.defaultTaskStatus = input.defaultTaskStatus;
  // Keep order, drop duplicates case-insensitively.
  const dedupe = (list: string[]) => { const seen = new Set<string>(); return list.filter((d) => { const k = d.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
  // A95: affects the next code issued, never one already given out.
  if (input.employeeCodePrefix !== undefined) c.set("employeeCodePrefix", input.employeeCodePrefix);
  if (input.employeeCodePadding !== undefined) c.set("employeeCodePadding", input.employeeCodePadding);
  if (input.payrollStartDay !== undefined) c.set("payrollStartDay", input.payrollStartDay);
  if (input.approvalChain !== undefined) c.set("approvalChain", input.approvalChain);
  if (input.workProof !== undefined) c.set("workProof", { ...(c.workProof ?? {}), ...input.workProof });
  if (input.designations !== undefined) c.set("designations", dedupe(input.designations));
  if (input.services !== undefined) c.set("services", dedupe(input.services));
  if (input.hiddenNav !== undefined) {
    for (const [role, hrefs] of Object.entries(input.hiddenNav)) if (hrefs) c.set(`hiddenNav.${role}`, [...new Set(hrefs)]);
  }
  if (input.setupCompleted !== undefined) c.setupCompleted = input.setupCompleted;
  await c.save();
  const after = serializeCompany(c.toObject() as Record<string, unknown>);
  await audit({ ctx, companyId: ctx.companyId, entity: "company", entityId: c._id, action: "company.settings_updated", summary: "Company settings updated", before, after, ip });
  return after;
}

export async function setCompanyLogo(ctx: CompanyContext, buffer: Buffer, ext: string, mime: string, ip: string | null) {
  const key = `companies/${ctx.companyId}/logo-${Date.now()}.${ext}`;
  await storage().put({ key, body: buffer, contentType: mime });
  const url = await storage().getSignedUrl(key, 60 * 60 * 24 * 365);
  await Company.updateOne({ _id: ctx.companyId }, { $set: { logoUrl: url } });
  await audit({ ctx, companyId: ctx.companyId, entity: "company", entityId: ctx.companyId, action: "company.logo_updated", summary: "Company logo updated", ip });
  return { logoUrl: url };
}

/** Company-wide KPIs for the admin dashboard (spec 12.6). Timer/attendance figures arrive in Phase 3. */
export async function adminDashboardStats(ctx: CompanyContext) {
  const users = scoped(User, ctx);
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [headcount, invited, activeToday, teams, usage, recentAudit] = await Promise.all([
    users.countDocuments({ status: "active", archivedAt: null }),
    users.countDocuments({ status: "invited", archivedAt: null }),
    users.countDocuments({ status: "active", archivedAt: null, lastActiveAt: { $gte: since } }),
    scoped(Team, ctx).countDocuments({ archivedAt: null }),
    planUsage(ctx.companyId),
    AuditLog.find({ companyId: new Types.ObjectId(ctx.companyId) }).sort({ createdAt: -1 }).limit(8).lean(),
  ]);
  return {
    headcount, invited, activeToday, teams, usage,
    recentAudit: recentAudit.map((a) => ({ id: String(a._id), action: a.action, summary: a.summary ?? null, actorName: a.actorName ?? null, createdAt: a.createdAt })),
  };
}

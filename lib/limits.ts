import { Types } from "mongoose";
import { Company } from "@/models/Company";
import { Plan } from "@/models/Plan";
import { User } from "@/models/User";
import { Client } from "@/models/Client";
import { Project } from "@/models/Project";
import { Task } from "@/models/Task";
import { Message } from "@/models/Message";
import { ApiError } from "@/lib/api/errors";

export type LimitKey = "users" | "projects" | "clients" | "storage";

async function planFor(cid: Types.ObjectId) {
  const company = await Company.findById(cid).select("planId name").lean();
  if (!company) throw new ApiError(404, "COMPANY_NOT_FOUND", "Company not found");
  return company.planId ? await Plan.findById(company.planId).lean() : await Plan.findOne({ isDefault: true }).lean();
}

/** Storage = bytes of task + chat attachments (company logo excluded), reported in MB. */
async function storageBytes(cid: Types.ObjectId) {
  const [t, m] = await Promise.all([
    Task.aggregate<{ bytes: number }>([{ $match: { companyId: cid } }, { $unwind: "$attachments" }, { $group: { _id: null, bytes: { $sum: "$attachments.size" } } }]),
    Message.aggregate<{ bytes: number }>([{ $match: { companyId: cid, deletedAt: null } }, { $unwind: "$attachments" }, { $group: { _id: null, bytes: { $sum: "$attachments.size" } } }]),
  ]);
  return (t[0]?.bytes ?? 0) + (m[0]?.bytes ?? 0);
}

async function usageOf(cid: Types.ObjectId) {
  const [users, clients, projects, bytes] = await Promise.all([
    User.countDocuments({ companyId: cid, status: { $ne: "deactivated" }, archivedAt: null }),
    Client.countDocuments({ companyId: cid, archivedAt: null }),
    Project.countDocuments({ companyId: cid, archivedAt: null }),
    storageBytes(cid),
  ]);
  return { users, clients, projects, storageMB: Math.round((bytes / 1048576) * 100) / 100 };
}

/**
 * Centralized plan limits (spec section 15). Called at every creation point.
 * Throws a PLAN_LIMIT_REACHED ApiError with an upgrade prompt when exceeded.
 */
export async function checkLimit(companyId: string | Types.ObjectId, key: LimitKey, extra: { addBytes?: number } = {}): Promise<void> {
  const cid = new Types.ObjectId(String(companyId));
  const plan = await planFor(cid);
  if (!plan?.limits) return; // no plan configured: no limits enforced
  const usage = await usageOf(cid);
  if (key === "storage") {
    const limitMB = plan.limits.storageMB;
    const afterMB = usage.storageMB + (extra.addBytes ?? 0) / 1048576;
    if (limitMB >= 0 && afterMB > limitMB) throw new ApiError(402, "PLAN_LIMIT_REACHED", `Your ${plan.name} plan includes ${limitMB} MB of storage. Upgrade your plan for more space.`, { key, used: usage.storageMB, limit: limitMB, plan: plan.name, upgradeUrl: "/settings?tab=subscription" });
    return;
  }
  const used = usage[key];
  const limit = plan.limits[key];
  if (limit >= 0 && used >= limit) {
    throw new ApiError(402, "PLAN_LIMIT_REACHED", `Your ${plan.name} plan allows ${limit} ${key}. Upgrade your plan to add more.`, {
      key, used, limit, plan: plan.name, upgradeUrl: "/settings?tab=subscription",
    });
  }
}

export async function planUsage(companyId: string | Types.ObjectId) {
  const cid = new Types.ObjectId(String(companyId));
  const plan = await planFor(cid);
  return { plan: plan ? { name: plan.name, limits: plan.limits } : null, usage: await usageOf(cid) };
}

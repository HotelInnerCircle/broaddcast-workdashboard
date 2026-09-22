import { Types } from "mongoose";
import { NextResponse } from "next/server";
import { route } from "@/lib/api/handler";
import { parseQuery } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { auditQuerySchema } from "@/lib/validation/billing";
import { AuditLog } from "@/models/AuditLog";
import { companyClock } from "@/lib/time/company-clock";

import { escapeRegex as escapeRx } from "@/lib/utils/regex";

/** Company audit log viewer (spec 7.9 / Phase 6) with action, entity, actor and date filters. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("auditLog", "view");
  const q = parseQuery(req, auditQuerySchema);
  const filter: Record<string, unknown> = { companyId: new Types.ObjectId(ctx.companyId) };
  if (q.action) filter.action = { $regex: escapeRx(q.action), $options: "i" };
  if (q.entity) filter.entity = q.entity;
  if (q.actorId) filter.actorId = new Types.ObjectId(q.actorId);
  if (q.from || q.to) {
    const clock = await companyClock(ctx.companyId);
    filter.createdAt = { ...(q.from ? { $gte: clock.at(q.from, "00:00") } : {}), ...(q.to ? { $lt: new Date(clock.at(q.to, "00:00").getTime() + 86_400_000) } : {}) };
  }
  const [total, rows, entities] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    AuditLog.distinct("entity", { companyId: new Types.ObjectId(ctx.companyId) }),
  ]);
  const data = rows.map((a) => ({ id: String(a._id), entity: a.entity, entityId: a.entityId ?? null, action: a.action, summary: a.summary ?? null, actorName: a.actorName ?? null, actorRole: a.actorRole ?? null, actorId: a.actorId ? String(a.actorId) : null, crossTenant: a.crossTenant, before: a.before ?? null, after: a.after ?? null, ip: a.ip ?? null, createdAt: a.createdAt }));
  return NextResponse.json({ data, meta: { page: q.page, limit: q.limit, total, totalPages: Math.max(1, Math.ceil(total / q.limit)), entities } });
});

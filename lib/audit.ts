import { Types } from "mongoose";
import { AuditLog } from "@/models/AuditLog";
import type { SessionContext } from "@/types";
import { realtime } from "@/lib/realtime";

export interface AuditInput {
  /** Actor context; null for unauthenticated system events (e.g. self-registration before login). */
  ctx: Pick<SessionContext, "userId" | "role" | "name"> | null;
  companyId: string | Types.ObjectId | null;
  entity: string;
  entityId?: string | Types.ObjectId | null;
  action: string;
  summary?: string;
  before?: unknown;
  after?: unknown;
  crossTenant?: boolean;
  ip?: string | null;
}

/** The single write path into the append-only AuditLog (spec 7.9). Never throws into callers. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    const entry = await AuditLog.create({
      companyId: input.companyId ? new Types.ObjectId(String(input.companyId)) : null,
      actorId: input.ctx?.userId ? new Types.ObjectId(input.ctx.userId) : null,
      actorRole: input.ctx?.role ?? null,
      actorName: input.ctx?.name ?? null,
      entity: input.entity,
      entityId: input.entityId ? String(input.entityId) : null,
      action: input.action,
      summary: input.summary ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      crossTenant: input.crossTenant ?? false,
      ip: input.ip ?? null,
    });
    // Live activity feed (spec 10, 12.1): ids + summary only; clients refetch details.
    if (input.companyId) realtime().emitToCompany(String(input.companyId), "activity:new", { id: String(entry._id), action: input.action, summary: input.summary ?? null, actorId: input.ctx?.userId ?? null, actorName: input.ctx?.name ?? null, entity: input.entity, entityId: input.entityId ? String(input.entityId) : null, createdAt: entry.createdAt });
  } catch (err) {
    console.error("[audit] failed to write entry", input.action, err);
  }
}

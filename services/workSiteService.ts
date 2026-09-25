import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { WorkSite } from "@/models/WorkSite";
import type { CompanyContext } from "@/lib/auth/context";
import type { WorkSiteInput, WorkSitePatchInput } from "@/lib/validation/swipes";

export interface WorkSiteRow {
  id: string; name: string; address: string | null;
  lat: number; lng: number; radiusMeters: number; active: boolean;
}

const serialize = (s: Record<string, unknown>): WorkSiteRow => ({
  id: String(s._id),
  name: s.name as string,
  address: (s.address as string | null) ?? null,
  lat: s.lat as number,
  lng: s.lng as number,
  radiusMeters: s.radiusMeters as number,
  active: Boolean(s.active),
});

/** Every site in the company, newest first. Inactive ones are listed too, greyed out in the UI. */
export async function listWorkSites(ctx: CompanyContext, opts: { activeOnly?: boolean } = {}): Promise<WorkSiteRow[]> {
  const filter = opts.activeOnly ? { active: true } : {};
  const rows = await scoped(WorkSite, ctx).find(filter).sort({ createdAt: -1 }).lean();
  return rows.map((r) => serialize(r as Record<string, unknown>));
}

export async function createWorkSite(ctx: CompanyContext, input: WorkSiteInput, ip: string | null): Promise<WorkSiteRow> {
  if (await scoped(WorkSite, ctx).exists({ name: input.name })) {
    throw Errors.conflict("SITE_NAME_TAKEN", "A site with this name already exists");
  }
  const site = await scoped(WorkSite, ctx).create({
    ...input,
    address: input.address ?? null,
    active: input.active ?? true,
    createdBy: new Types.ObjectId(ctx.userId),
  });
  await audit({
    ctx, companyId: ctx.companyId, entity: "workSite", entityId: site._id, action: "work_site.created",
    summary: `${ctx.name} added the work site ${input.name} (${input.radiusMeters} m)`,
    after: { name: input.name, lat: input.lat, lng: input.lng, radiusMeters: input.radiusMeters }, ip,
  });
  return serialize(site.toObject() as Record<string, unknown>);
}

export async function updateWorkSite(ctx: CompanyContext, id: string, input: WorkSitePatchInput, ip: string | null): Promise<WorkSiteRow> {
  const site = await scoped(WorkSite, ctx).findById(id);
  if (!site) throw Errors.notFound("Work site");
  if (input.name && input.name !== site.name && (await scoped(WorkSite, ctx).exists({ name: input.name }))) {
    throw Errors.conflict("SITE_NAME_TAKEN", "A site with this name already exists");
  }
  const before = { name: site.name, lat: site.lat, lng: site.lng, radiusMeters: site.radiusMeters, active: site.active };
  Object.assign(site, input);
  await site.save();
  await audit({
    ctx, companyId: ctx.companyId, entity: "workSite", entityId: site._id, action: "work_site.updated",
    summary: `${ctx.name} updated the work site ${site.name}`, before, after: input, ip,
  });
  return serialize(site.toObject() as Record<string, unknown>);
}

/**
 * Deletes a site. Swipes already measured against it keep their own copy of the name and the
 * distance, so removing a site never rewrites history.
 */
export async function deleteWorkSite(ctx: CompanyContext, id: string, ip: string | null): Promise<void> {
  const site = await scoped(WorkSite, ctx).findById(id);
  if (!site) throw Errors.notFound("Work site");
  const name = site.name;
  await scoped(WorkSite, ctx).deleteOne({ _id: site._id });
  await audit({
    ctx, companyId: ctx.companyId, entity: "workSite", entityId: site._id, action: "work_site.deleted",
    summary: `${ctx.name} deleted the work site ${name}`, before: { name }, ip,
  });
}

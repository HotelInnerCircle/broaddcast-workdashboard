import { Types } from "mongoose";
import { formatInTimeZone } from "date-fns-tz";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { storage, validateUpload, sniffMatches } from "@/lib/storage";
import { companyClock } from "@/lib/time/company-clock";
import { distanceMeters, isValidCoord } from "@/lib/geo";
import { stampPhoto } from "@/lib/attendance/stamp";
import { notify, notifyMany } from "@/services/notificationService";
import { employeeScopeFilter } from "@/services/scope";
import { AttendanceSwipe, type AttendanceSwipeDoc } from "@/models/AttendanceSwipe";
import { WorkSite } from "@/models/WorkSite";
import { Team } from "@/models/Team";
import { User } from "@/models/User";
import type { CompanyContext } from "@/lib/auth/context";

export interface SwipeRow {
  id: string; userId: string; userName: string; type: string; at: string; date: string;
  photoUrl: string; lat: number; lng: number; accuracyMeters: number | null;
  siteName: string | null; distanceMeters: number | null; withinGeofence: boolean;
  status: string; currentStep: string | null;
  approvals: Array<{ step: string; decision: string; decidedByName: string | null; decidedAt: string | null; note: string | null }>;
  note: string | null;
}

/**
 * Who has to agree when a swipe lands outside every site (A83), in order.
 *
 * A step is only added when there is a distinct person to fill it: a team lead swiping from home
 * does not approve their own swipe, and somebody with no manager does not wait forever for one.
 * The HR step is always present, and always settleable - any HR may act, and a Company Admin may
 * act on any step - so a pending swipe can never be stranded with nobody able to decide it.
 */
async function buildChain(ctx: CompanyContext, userId: Types.ObjectId) {
  const [user, hrCount] = await Promise.all([
    scoped(User, ctx).findById(String(userId)).select("teamId managerId").lean(),
    scoped(User, ctx).countDocuments({ role: "HR", status: "active", archivedAt: null }),
  ]);
  const team = user?.teamId ? await scoped(Team, ctx).findById(String(user.teamId)).select("leadId managerId").lean() : null;

  const steps: Array<{ step: "TEAM_LEAD" | "MANAGER" | "HR"; approverId: Types.ObjectId | null }> = [];
  const isSelf = (id: unknown) => id && String(id) === String(userId);

  if (team?.leadId && !isSelf(team.leadId)) steps.push({ step: "TEAM_LEAD", approverId: team.leadId as Types.ObjectId });
  const managerId = user?.managerId ?? team?.managerId ?? null;
  if (managerId && !isSelf(managerId)) steps.push({ step: "MANAGER", approverId: managerId as Types.ObjectId });
  // Always last, whether or not an HR has been appointed yet - the admin can settle it either way.
  steps.push({ step: "HR", approverId: null });

  return { steps, hrCount };
}

/** A swipe as the UI wants it, with a freshly signed photo URL (objects are private). */
export async function serializeSwipe(s: Record<string, unknown>, names: Map<string, string>): Promise<SwipeRow> {
  const approvals = (s.approvals as Array<Record<string, unknown>>) ?? [];
  const idx = s.currentStep as number | null;
  return {
    id: String(s._id),
    userId: String(s.userId),
    userName: names.get(String(s.userId)) ?? "Unknown",
    type: s.type as string,
    at: new Date(s.at as string).toISOString(),
    date: s.date as string,
    photoUrl: await storage().getSignedUrl(s.photoKey as string, 3600),
    lat: s.lat as number,
    lng: s.lng as number,
    accuracyMeters: (s.accuracyMeters as number | null) ?? null,
    siteName: (s.siteName as string | null) ?? null,
    distanceMeters: (s.distanceMeters as number | null) ?? null,
    withinGeofence: Boolean(s.withinGeofence),
    status: s.status as string,
    currentStep: idx !== null && approvals[idx] ? (approvals[idx].step as string) : null,
    approvals: approvals.map((a) => ({
      step: a.step as string,
      decision: a.decision as string,
      decidedByName: a.decidedBy ? (names.get(String(a.decidedBy)) ?? "Unknown") : null,
      decidedAt: a.decidedAt ? new Date(a.decidedAt as string).toISOString() : null,
      note: (a.note as string | null) ?? null,
    })),
    note: (s.note as string | null) ?? null,
  };
}

/** Names for every user id referenced by a page of swipes, in one query. */
export async function namesFor(ctx: CompanyContext, docs: Array<Record<string, unknown>>): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const d of docs) {
    ids.add(String(d.userId));
    for (const a of ((d.approvals as Array<Record<string, unknown>>) ?? [])) if (a.decidedBy) ids.add(String(a.decidedBy));
  }
  if (ids.size === 0) return new Map();
  const users = await scoped(User, ctx).find({ _id: { $in: [...ids].map((i) => new Types.ObjectId(i)) } }).select("name").lean();
  return new Map(users.map((u) => [String(u._id), u.name as string]));
}

/**
 * Records a swipe (A83). The server decides the time and whether it was inside a site; the device
 * only supplies the photo and where it thinks it is.
 */
export async function createSwipe(
  ctx: CompanyContext,
  input: { type: "ON_DUTY" | "OFF_DUTY"; lat: number; lng: number; accuracyMeters?: number; note?: string },
  photo: File,
  ip: string | null,
): Promise<SwipeRow> {
  if (!isValidCoord(input.lat, input.lng)) {
    throw Errors.bad("NO_LOCATION", "Your location could not be read. Turn location on and try again.");
  }
  const { mime } = validateUpload(photo, { imagesOnly: true });
  const raw = Buffer.from(await photo.arrayBuffer());
  if (!sniffMatches(raw, mime)) throw Errors.bad("BAD_IMAGE", "That file is not the image it claims to be");

  const clock = await companyClock(ctx.companyId);
  const at = new Date(); // the server's clock, never the phone's
  const date = clock.dayOf(at);
  const uid = new Types.ObjectId(ctx.userId);

  const sites = await scoped(WorkSite, ctx).find({ active: true }).lean();
  let nearest: (typeof sites)[number] | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const s of sites) {
    const d = distanceMeters({ lat: input.lat, lng: input.lng }, { lat: s.lat as number, lng: s.lng as number });
    if (d < best) { best = d; nearest = s; }
  }
  const within = Boolean(nearest && best <= (nearest.radiusMeters as number));

  const stamped = await stampPhoto(raw, {
    brand: "WorkPulse",
    title: `${ctx.name} - ${input.type === "ON_DUTY" ? "ON DUTY" : "OFF DUTY"}`,
    when: formatInTimeZone(at, clock.timezone, "dd/MM/yyyy hh:mm:ss a"),
    coords: `${input.lat.toFixed(6)}, ${input.lng.toFixed(6)}${input.accuracyMeters ? `  +/-${Math.round(input.accuracyMeters)} m` : ""}`,
    place: nearest
      ? `${nearest.name} - ${within ? "inside" : "OUTSIDE"} (${best} m from centre)`
      : "No work site configured",
  });

  const key = `companies/${ctx.companyId}/swipes/${date}/${crypto.randomUUID()}.jpg`;
  await storage().put({ key, body: stamped.buffer, contentType: stamped.contentType });

  const chain = within ? { steps: [] as Array<{ step: "TEAM_LEAD" | "MANAGER" | "HR"; approverId: Types.ObjectId | null }> } : await buildChain(ctx, uid);
  const swipe = await scoped(AttendanceSwipe, ctx).create({
    userId: uid, date, type: input.type, at,
    photoKey: key,
    lat: input.lat, lng: input.lng, accuracyMeters: input.accuracyMeters ?? null,
    siteId: nearest?._id ?? null,
    siteName: (nearest?.name as string | undefined) ?? null,
    distanceMeters: nearest ? best : null,
    withinGeofence: within,
    status: within ? "APPROVED" : "PENDING",
    currentStep: within ? null : 0,
    approvals: chain.steps.map((s) => ({ step: s.step, approverId: s.approverId, decision: "PENDING" })),
    note: input.note ?? null,
  });

  if (!within) await notifyStep(ctx, swipe as unknown as AttendanceSwipeDoc & { _id: Types.ObjectId });
  await audit({
    ctx, companyId: ctx.companyId, entity: "attendanceSwipe", entityId: swipe._id, action: "attendance.swipe",
    summary: `${ctx.name} swiped ${input.type === "ON_DUTY" ? "on duty" : "off duty"} - ${within ? `at ${nearest!.name}` : `outside every site (${best} m away)`}`,
    after: { type: input.type, within, distanceMeters: nearest ? best : null, date }, ip,
  });

  const names = await namesFor(ctx, [swipe.toObject() as Record<string, unknown>]);
  return serializeSwipe(swipe.toObject() as Record<string, unknown>, names);
}

/** Tells whoever the swipe is now waiting on that it is waiting on them. */
async function notifyStep(ctx: CompanyContext, swipe: AttendanceSwipeDoc & { _id: Types.ObjectId }) {
  const idx = swipe.currentStep;
  if (idx === null || idx === undefined) return;
  const step = swipe.approvals[idx];
  if (!step) return;
  const body = `${ctx.name} swiped ${swipe.type === "ON_DUTY" ? "on duty" : "off duty"} ${swipe.distanceMeters === null ? "with no work site configured" : `${swipe.distanceMeters} m from ${swipe.siteName}`}`;
  const payload = {
    type: "ATTENDANCE_SWIPE" as const,
    title: "Attendance swipe needs approval",
    body,
    link: `/attendance/swipes?id=${String(swipe._id)}`,
    actorId: swipe.userId,
  };
  if (step.approverId) {
    await notify(ctx.companyId, { ...payload, userId: String(step.approverId) });
    return;
  }
  // The HR step: every HR, and the admins as the always-available fallback.
  const people = await scoped(User, ctx).find({ role: { $in: ["HR", "COMPANY_ADMIN"] }, status: "active", archivedAt: null }).select("_id").lean();
  await notifyMany(ctx.companyId, people.map((p) => String(p._id)), payload);
}

/**
 * One step of the chain decides (A83).
 *
 * Who may act: the named approver for the current step; any HR when the step is HR; and a Company
 * Admin on any step, because they own the company and are the reason a swipe can always be
 * settled. Nobody decides their own swipe, whatever their role.
 */
export async function decideSwipe(
  ctx: CompanyContext,
  id: string,
  input: { decision: "APPROVED" | "REJECTED"; note?: string },
  ip: string | null,
): Promise<SwipeRow> {
  const swipe = await scoped(AttendanceSwipe, ctx).findById(id);
  if (!swipe) throw Errors.notFound("Swipe");
  if (swipe.status !== "PENDING" || swipe.currentStep === null || swipe.currentStep === undefined) {
    throw Errors.bad("ALREADY_SETTLED", "This swipe has already been decided");
  }
  if (String(swipe.userId) === ctx.userId) throw Errors.forbidden("You cannot decide your own swipe");

  const step = swipe.approvals[swipe.currentStep];
  if (!step) throw Errors.bad("NO_STEP", "This swipe has no step waiting");
  const allowed =
    ctx.role === "COMPANY_ADMIN" ||
    (step.step === "HR" && ctx.role === "HR") ||
    (step.approverId !== null && step.approverId !== undefined && String(step.approverId) === ctx.userId);
  if (!allowed) throw Errors.forbidden("This swipe is waiting on someone else");

  step.decision = input.decision;
  step.decidedBy = new Types.ObjectId(ctx.userId);
  step.decidedAt = new Date();
  step.note = input.note ?? null;

  if (input.decision === "REJECTED") {
    swipe.status = "REJECTED";
    swipe.currentStep = null;
  } else if (swipe.currentStep + 1 < swipe.approvals.length) {
    swipe.currentStep = swipe.currentStep + 1;
  } else {
    swipe.status = "APPROVED";
    swipe.currentStep = null;
  }
  await swipe.save();

  if (swipe.status === "PENDING") {
    await notifyStep(ctx, swipe as unknown as AttendanceSwipeDoc & { _id: Types.ObjectId });
  } else {
    await notify(ctx.companyId, {
      userId: String(swipe.userId),
      type: "ATTENDANCE_SWIPE",
      title: swipe.status === "APPROVED" ? "Attendance swipe approved" : "Attendance swipe rejected",
      body: `Your ${swipe.type === "ON_DUTY" ? "on duty" : "off duty"} swipe on ${swipe.date} was ${swipe.status.toLowerCase()} by ${ctx.name}`,
      link: "/attendance/swipes",
      actorId: ctx.userId,
    });
  }

  await audit({
    ctx, companyId: ctx.companyId, entity: "attendanceSwipe", entityId: swipe._id, action: `attendance.swipe_${input.decision.toLowerCase()}`,
    summary: `${ctx.name} ${input.decision === "APPROVED" ? "approved" : "rejected"} a swipe at the ${step.step.replace("_", " ").toLowerCase()} step`,
    after: { status: swipe.status, step: step.step }, ip,
  });

  const names = await namesFor(ctx, [swipe.toObject() as Record<string, unknown>]);
  return serializeSwipe(swipe.toObject() as Record<string, unknown>, names);
}

/**
 * Swipes the caller is allowed to see, newest first. Scope follows the same people rules as the
 * rest of the app: an employee sees their own, a lead their team, a manager their scope, HR and
 * the admin the whole company. `mine` narrows it to what is waiting on the caller right now.
 */
export async function listSwipes(
  ctx: CompanyContext,
  q: { from?: string; to?: string; userId?: string; status?: string; mine?: boolean; page: number; limit: number },
) {
  const visible = await scoped(User, ctx).find(await employeeScopeFilter(ctx)).select("_id").lean();
  const visibleIds = visible.map((v) => v._id as Types.ObjectId);

  const filter: Record<string, unknown> = { userId: { $in: visibleIds } };
  if (q.userId) filter.userId = new Types.ObjectId(q.userId);
  if (q.status) filter.status = q.status;
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };

  if (q.mine) {
    // Waiting on me: my own named step, or the HR step when I can settle it.
    const canSettleHr = ctx.role === "HR" || ctx.role === "COMPANY_ADMIN";
    const or: Record<string, unknown>[] = [{ "approvals.approverId": new Types.ObjectId(ctx.userId) }];
    if (canSettleHr) or.push({ "approvals.step": "HR" });
    filter.status = "PENDING";
    filter.$or = or;
    delete filter.userId; // an approver is rarely inside their own visibility filter for this
    if (ctx.role !== "COMPANY_ADMIN" && ctx.role !== "HR") filter.userId = { $in: visibleIds };
  }

  const total = await scoped(AttendanceSwipe, ctx).countDocuments(filter);
  const docs = await scoped(AttendanceSwipe, ctx)
    .find(filter).sort({ at: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean();

  const plain = docs as Array<Record<string, unknown>>;
  const names = await namesFor(ctx, plain);
  const data = await Promise.all(plain.map((d) => serializeSwipe(d, names)));
  return { data, page: q.page, limit: q.limit, total };
}

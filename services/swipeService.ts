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
import { employeeScopeFilter, requireVisibleEmployee } from "@/services/scope";
import { AttendanceSwipe, type AttendanceSwipeDoc } from "@/models/AttendanceSwipe";
import { WorkSite } from "@/models/WorkSite";
import { Team } from "@/models/Team";
import { User } from "@/models/User";
import type { CompanyContext } from "@/lib/auth/context";

export interface SwipeRow {
  id: string; userId: string; userName: string; type: string; at: string; date: string;
  photoUrl: string; lat: number; lng: number; accuracyMeters: number | null;
  siteName: string | null; distanceMeters: number | null; withinGeofence: boolean;
  /** What the face check made of it (A108): matched, mismatch, or not checked. */
  faceVerdict: string; faceDistance: number | null;
  /** How many tries it took (A116) - one bad photograph reads very differently from five. */
  faceAttempts: number;
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
    faceVerdict: (s.faceVerdict as string | undefined) ?? "unverified",
    faceDistance: (s.faceDistance as number | null) ?? null,
    faceAttempts: (s.faceAttempts as number | undefined) ?? 0,
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
  input: { type: "ON_DUTY" | "OFF_DUTY"; lat: number; lng: number; accuracyMeters?: number; note?: string; faceDescriptor?: unknown; faceAttempts?: number },
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

  /*
   * The face check (A108), before the photograph is stored (A116).
   *
   * A face that does not match asks for another try rather than being recorded
   * straight away: somebody half in shadow, or turned away from the lens, took
   * a bad photograph rather than committed a fraud, and the honest fix is to
   * take it again. `maxRetries` was in the settings for exactly this from the
   * start and was never read.
   *
   * After that many tries it goes through anyway, marked, down the same road an
   * off-site swipe takes. Refusing for ever would mean somebody with a new
   * beard, a bandage or bad light simply cannot clock in - and that becomes an
   * argument about pay, which is the one thing this must never cause.
   *
   * Checked before the upload so a refused attempt leaves no orphaned file: at
   * three tries each, storing every rejected photograph would cost more than
   * the swipes themselves.
   */
  const { checkFace, faceSettings } = await import("./faceService");
  const face = await checkFace(ctx, input.faceDescriptor);
  const faceFailed = face.verdict === "mismatch";
  const attempts = Math.max(0, Math.min(20, Math.trunc(Number(input.faceAttempts) || 0)));

  if (faceFailed) {
    const settings = await faceSettings(ctx.companyId);
    if (attempts + 1 < settings.maxRetries) {
      throw Errors.bad(
        "FACE_MISMATCH",
        "That does not look like you. Take the photo again, facing the camera in good light.",
        { attempts: attempts + 1, maxRetries: settings.maxRetries },
      );
    }
  }

  const key = `companies/${ctx.companyId}/swipes/${date}/${crypto.randomUUID()}.jpg`;
  await storage().put({ key, body: stamped.buffer, contentType: stamped.contentType });

  const autoApprove = within && !faceFailed;
  const chain = autoApprove
    ? { steps: [] as Array<{ step: "TEAM_LEAD" | "MANAGER" | "HR"; approverId: Types.ObjectId | null }> }
    : await buildChain(ctx, uid);
  const swipe = await scoped(AttendanceSwipe, ctx).create({
    userId: uid, date, type: input.type, at,
    photoKey: key,
    lat: input.lat, lng: input.lng, accuracyMeters: input.accuracyMeters ?? null,
    siteId: nearest?._id ?? null,
    siteName: (nearest?.name as string | undefined) ?? null,
    distanceMeters: nearest ? best : null,
    withinGeofence: within,
    faceVerdict: face.verdict,
    faceDistance: face.distance,
    // How many tries it took, kept so a reviewer can see the difference between
    // one bad photograph and somebody trying repeatedly to get past the check.
    faceAttempts: attempts,
    status: autoApprove ? "APPROVED" : "PENDING",
    currentStep: within ? null : 0,
    approvals: chain.steps.map((s) => ({ step: s.step, approverId: s.approverId, decision: "PENDING" })),
    note: input.note ?? null,
  });

  /*
   * The day's attendance follows from the swipes (A121). There is no separate
   * clocking in any more: the swipe carries a photograph, a place and an
   * approval trail, and it is the thing payroll should be counting.
   */
  const { syncAttendanceFromSwipes } = await import("./attendanceService");
  await syncAttendanceFromSwipes(ctx, ctx.userId, date);

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

  /*
   * And again once somebody has decided on it: a rejected swipe stops counting,
   * so the day it belonged to has to be worked out again without it. Recomputed
   * from scratch rather than adjusted, so approving and rejecting the same
   * swipe twice cannot leave the day half-corrected.
   */
  const { syncAttendanceFromSwipes } = await import("./attendanceService");
  await syncAttendanceFromSwipes(ctx, String(swipe.userId), swipe.date as string);

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
  // A swipe carries a photo and a location, so this one is checked rather than
  // filtered: assigning over the visible ids would expose both to anyone asking.
  if (q.userId) filter.userId = await requireVisibleEmployee(ctx, q.userId);
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

/**
 * A swipe recorded by a device at a door (A126).
 *
 * Deliberately separate from `createSwipe` rather than a flag on it. The two
 * differ in who is asking and in what can be believed: a phone swipe is made by
 * somebody signed in, standing wherever they say they are, and a door swipe is
 * made by a device that cannot move and has no idea who walked up until the
 * face is matched. Folding both into one function would mean a string of
 * conditionals around every check, and a mistake in any of them would be a hole
 * in the side with the tablet on the wall.
 *
 * What is the same on purpose: the photograph is stamped and stored exactly as
 * a phone swipe's is, the day is derived from the swipes afterwards, and the
 * record carries what the face check made of it.
 */
export async function swipeAtDoor(
  device: { companyId: string; deviceId: string; deviceName: string; siteId: string },
  userId: string,
  photo: File,
  meta: { live: boolean; distance: number | null },
  ip: string | null,
) {
  const { mime } = validateUpload(photo, { imagesOnly: true });
  const raw = Buffer.from(await photo.arrayBuffer());
  if (!sniffMatches(raw, mime)) throw Errors.bad("BAD_IMAGE", "That file is not the image it claims to be");

  const ctx = { companyId: device.companyId, userId, role: "EMPLOYEE", name: device.deviceName } as unknown as CompanyContext;
  const clock = await companyClock(device.companyId);
  const at = new Date(); // the server's clock, never the device's
  const date = clock.dayOf(at);
  const uid = new Types.ObjectId(userId);

  const site = await WorkSite.findById(new Types.ObjectId(device.siteId))
    .setOptions({ skipTenantGuard: true } as never)
    .select("name lat lng").lean();

  /*
   * On duty or off duty is not asked, it is worked out. Nobody at a door should
   * have to tell a tablet which direction they are walking, and the answer is
   * already known: whatever they did last today, they are doing the other now.
   */
  const last = await AttendanceSwipe.findOne({ companyId: new Types.ObjectId(device.companyId), userId: uid, date, status: { $ne: "REJECTED" } })
    .setOptions({ skipTenantGuard: true } as never)
    .sort({ at: -1 }).select("type").lean();
  const type: "ON_DUTY" | "OFF_DUTY" = last?.type === "ON_DUTY" ? "OFF_DUTY" : "ON_DUTY";

  const user = await User.findById(uid).setOptions({ skipTenantGuard: true } as never).select("name").lean();

  const stamped = await stampPhoto(raw, {
    brand: "WorkPulse",
    title: `${user?.name ?? "Employee"} - ${type === "ON_DUTY" ? "ON DUTY" : "OFF DUTY"}`,
    when: formatInTimeZone(at, clock.timezone, "dd/MM/yyyy hh:mm:ss a"),
    coords: `${device.deviceName}`,
    place: `${site?.name ?? "Work site"} - at the door`,
  });

  const key = `companies/${device.companyId}/swipes/${date}/${crypto.randomUUID()}.jpg`;
  await storage().put({ key, body: stamped.buffer, contentType: stamped.contentType });

  /*
   * Approved on the spot. A device bolted to a wall at a known site is the one
   * case where "were they really there" is not in question - it cannot be
   * carried home. What is in question is whether the face was live, and that is
   * recorded rather than used to refuse: a person the camera would not see
   * blink must not be locked out of their own attendance, but somebody should
   * be able to find those swipes afterwards.
   */
  const swipe = await AttendanceSwipe.create({
    companyId: new Types.ObjectId(device.companyId),
    userId: uid, date, type, at,
    photoKey: key,
    lat: (site?.lat as number) ?? 0, lng: (site?.lng as number) ?? 0,
    accuracyMeters: null,
    siteId: site?._id ?? null,
    siteName: (site?.name as string | undefined) ?? null,
    distanceMeters: 0,
    withinGeofence: true,
    faceVerdict: "matched",
    faceDistance: meta.distance,
    faceAttempts: 0,
    source: "DOOR_DEVICE",
    deviceId: new Types.ObjectId(device.deviceId),
    liveness: meta.live ? "blink" : "none",
    status: "APPROVED",
    currentStep: null,
    approvals: [],
    note: null,
  });

  await audit({
    ctx, companyId: device.companyId, entity: "attendanceSwipe", entityId: swipe._id,
    action: "attendance.swipe",
    summary: `${user?.name ?? "Somebody"} swiped ${type === "ON_DUTY" ? "on duty" : "off duty"} at ${device.deviceName}${meta.live ? "" : " (no blink seen)"}`,
    after: { type, device: device.deviceName, live: meta.live, faceDistance: meta.distance }, ip,
  });

  const { syncAttendanceFromSwipes } = await import("./attendanceService");
  await syncAttendanceFromSwipes(ctx, userId, date);

  return { type, at: at.toISOString(), siteName: (site?.name as string | undefined) ?? null, live: meta.live };
}

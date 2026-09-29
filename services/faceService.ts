import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { User } from "@/models/User";
import { storage } from "@/lib/storage";
import { Company } from "@/models/Company";
import { averageDescriptors, compareFace, isDescriptor, DEFAULT_THRESHOLD, type FaceComparison } from "@/lib/face/match";
import type { CompanyContext } from "@/lib/auth/context";

export interface FaceSettings { enabled: boolean; threshold: number; maxRetries: number; enrolAtSite: boolean }

export async function faceSettings(companyId: string): Promise<FaceSettings> {
  const c = await Company.findById(companyId).select("faceCheck").lean();
  const f = (c?.faceCheck ?? {}) as Record<string, unknown>;
  return {
    // Off unless switched on: turning it on before people have enrolled would
    // stop everybody swiping.
    enabled: f.enabled === true,
    threshold: typeof f.threshold === "number" ? f.threshold : DEFAULT_THRESHOLD,
    maxRetries: typeof f.maxRetries === "number" ? f.maxRetries : 3,
    enrolAtSite: f.enrolAtSite !== false,
  };
}

/**
 * Enrol a face from several captures.
 *
 * Several, not one: a single photograph carries whatever that moment happened to
 * be - a shadow, an odd angle - and the average is closer to the face than to
 * any one picture of it. Fewer false rejections later, for a few more seconds now.
 */
export async function enrolFace(
  ctx: CompanyContext,
  samples: unknown,
  photo: File | null,
  where: { lat?: number; lng?: number } | null,
  ip: string | null,
) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw Errors.bad("NO_FACE", "No face was captured. Try again in better light.");
  }
  if (samples.length > 10) throw Errors.bad("TOO_MANY", "That is more captures than are needed");
  const good = samples.filter(isDescriptor);
  if (good.length < 2) {
    throw Errors.bad("NOT_ENOUGH", "Capture your face a few times so it can be recognised reliably.");
  }

  /*
   * Where they were standing (A120). The easiest way to enrol somebody else's
   * face is from a sofa, and the phone already knows where it is. Enforced only
   * when the company has drawn work sites - refusing everybody for being
   * outside a geofence nobody has configured would lock out the whole company
   * on the day the feature is switched on.
   */
  const settings = await faceSettings(ctx.companyId);
  if (settings.enrolAtSite) {
    const { WorkSite } = await import("@/models/WorkSite");
    const sites = await scoped(WorkSite, ctx).find({ active: true }).select("name lat lng radiusMeters").lean();
    if (sites.length > 0) {
      if (typeof where?.lat !== "number" || typeof where?.lng !== "number") {
        throw Errors.bad("NO_LOCATION", "Turn location on: your face has to be enrolled at a work site.");
      }
      const { distanceMeters } = await import("@/lib/geo");
      const inside = sites.some((s) =>
        distanceMeters({ lat: where.lat as number, lng: where.lng as number },
          { lat: s.lat as number, lng: s.lng as number }) <= (s.radiusMeters as number));
      if (!inside) {
        throw Errors.bad("OUTSIDE_SITE", "You have to be at a work site to enrol your face. Ask HR if you cannot get to one.");
      }
    }
  }

  /*
   * The photograph, so that approving is looking at a face rather than at a row
   * in a table. The descriptor is 128 numbers and cannot be turned back into a
   * picture, so without this there is nothing for a person to recognise.
   */
  let photoKey: string | null = null;
  if (photo) {
    const { validateUpload, sniffMatches, storage } = await import("@/lib/storage");
    const { compressImage } = await import("@/lib/storage/compress");
    const { mime } = validateUpload(photo, { imagesOnly: true });
    const raw = Buffer.from(await photo.arrayBuffer());
    if (!sniffMatches(raw, mime)) throw Errors.bad("BAD_IMAGE", "That file is not the image it claims to be");
    const small = await compressImage(raw, mime, "avatar");
    photoKey = `companies/${ctx.companyId}/face-enrolment/${ctx.userId}-${Date.now()}.${small.ext}`;
    await storage().put({ key: photoKey, body: small.buffer, contentType: small.contentType });
  }

  const previous = await scoped(User, ctx)
    .findOne({ _id: new Types.ObjectId(ctx.userId) }).select("facePhotoKey").lean();

  const descriptor = averageDescriptors(good);
  /*
   * Pending, always - including on a re-enrolment. An approval that survived
   * being re-enrolled would be worth nothing: somebody could get their own face
   * approved and then quietly replace it with a colleague's.
   */
  await scoped(User, ctx).updateOne(
    { _id: new Types.ObjectId(ctx.userId) },
    { $set: {
      faceDescriptor: descriptor, faceEnrolledAt: new Date(), faceSamples: good.length,
      faceApproval: "pending", facePhotoKey: photoKey,
      faceApprovedBy: null, faceApprovedAt: null, faceReviewNote: null,
    } },
  );
  if (previous?.facePhotoKey && previous.facePhotoKey !== photoKey) {
    const { storage } = await import("@/lib/storage");
    await storage().delete(previous.facePhotoKey as string).catch(() => { /* an orphan beats a failed enrolment */ });
  }
  await audit({
    ctx, companyId: ctx.companyId, entity: "user", entityId: new Types.ObjectId(ctx.userId),
    action: "face.enrolled", summary: `${ctx.name} enrolled their face for attendance`,
    after: { samples: good.length }, ip,
  });
  return { enrolled: true, approval: "pending", samples: good.length, enrolledAt: new Date().toISOString() };
}

/** Forget an enrolled face. Kept simple and always available: it is their data. */
export async function forgetFace(ctx: CompanyContext, userId: string | null, ip: string | null) {
  const target = userId ?? ctx.userId;
  if (target !== ctx.userId && ctx.role !== "COMPANY_ADMIN" && ctx.role !== "HR") {
    throw Errors.forbidden("Only HR can remove somebody else's face");
  }
  const user = await scoped(User, ctx).findOne({ _id: new Types.ObjectId(target) }).select("name").lean();
  if (!user) throw Errors.notFound("Employee");
  const held = await scoped(User, ctx)
    .findOne({ _id: new Types.ObjectId(target) }).select("facePhotoKey").lean();
  await scoped(User, ctx).updateOne(
    { _id: new Types.ObjectId(target) },
    { $set: {
      faceDescriptor: null, faceEnrolledAt: null, faceSamples: 0,
      faceApproval: "none", facePhotoKey: null, faceApprovedBy: null, faceApprovedAt: null, faceReviewNote: null,
    } },
  );
  if (held?.facePhotoKey) {
    const { storage } = await import("@/lib/storage");
    // Their face is their data: the picture goes with the numbers.
    await storage().delete(held.facePhotoKey as string).catch(() => {});
  }
  await audit({
    ctx, companyId: ctx.companyId, entity: "user", entityId: new Types.ObjectId(target),
    action: "face.removed", summary: `${ctx.name} removed ${target === ctx.userId ? "their own" : user.name + "'s"} enrolled face`, ip,
  });
  return { removed: true };
}

export async function faceStatus(ctx: CompanyContext) {
  const [user, settings] = await Promise.all([
    scoped(User, ctx).findOne({ _id: new Types.ObjectId(ctx.userId) }).select("faceEnrolledAt faceSamples faceApproval faceReviewNote").lean(),
    faceSettings(ctx.companyId),
  ]);
  return {
    enrolled: Boolean(user?.faceEnrolledAt),
    enrolledAt: user?.faceEnrolledAt ? new Date(user.faceEnrolledAt as Date).toISOString() : null,
    samples: (user?.faceSamples as number | undefined) ?? 0,
    /** none | pending | approved | rejected - the person is told where theirs stands. */
    approval: (user?.faceApproval as string | undefined) ?? "none",
    reviewNote: (user?.faceReviewNote as string | null) ?? null,
    required: settings.enabled,
    threshold: settings.threshold,
    maxRetries: settings.maxRetries,
  };
}

/**
 * Compare a freshly captured face against what this person enrolled.
 *
 * The descriptor is selected explicitly - it is `select: false` on the model, so
 * it only ever leaves the database when something means to use it.
 */
export async function checkFace(ctx: CompanyContext, captured: unknown): Promise<FaceComparison & { enabled: boolean }> {
  const settings = await faceSettings(ctx.companyId);
  if (!settings.enabled) return { verdict: "unverified", distance: null, threshold: settings.threshold, enabled: false };

  const user = await scoped(User, ctx)
    .findOne({ _id: new Types.ObjectId(ctx.userId) })
    .select("+faceDescriptor faceApproval").lean();
  /*
   * Only a face somebody has agreed to (A120). An enrolment still waiting on HR
   * is treated exactly as if nobody had enrolled - "unverified", never a
   * mismatch, because a person waiting on somebody else's queue has done
   * nothing wrong and must not be refused at the gate for it.
   */
  const approved = (user?.faceApproval as string | undefined) === "approved";
  const enrolled = approved ? ((user?.faceDescriptor as number[] | null) ?? null) : null;
  return { ...compareFace(captured, enrolled, settings.threshold), enabled: true };
}

/** Who has enrolled and who has not, for HR before switching the check on. */
export async function enrolmentRegister(ctx: CompanyContext) {
  const { employeeScopeFilter } = await import("./scope");
  const people = await scoped(User, ctx)
    .find({ $and: [await employeeScopeFilter(ctx), { archivedAt: null, status: { $ne: "deactivated" } }] } as never)
    .select("name employeeCode faceEnrolledAt faceSamples faceApproval faceApprovedAt faceReviewNote facePhotoKey").sort({ name: 1 }).lean();
  /*
   * The pictures are signed here, for the people waiting on a decision only
   * (A120). Those are the rows somebody has to look at; signing a link for
   * everybody who enrolled months ago would mint a few hundred URLs nobody
   * opens, and they expire in minutes anyway.
   */
  const rows = await Promise.all(people.map(async (u) => ({
    userId: String(u._id),
    userName: u.name as string,
    employeeCode: (u.employeeCode as string | null) ?? null,
    enrolled: Boolean(u.faceEnrolledAt),
    enrolledAt: u.faceEnrolledAt ? new Date(u.faceEnrolledAt as Date).toISOString() : null,
    samples: (u.faceSamples as number | undefined) ?? 0,
    approval: (u.faceApproval as string | undefined) ?? "none",
    approvedAt: u.faceApprovedAt ? new Date(u.faceApprovedAt as Date).toISOString() : null,
    reviewNote: (u.faceReviewNote as string | null) ?? null,
    photoUrl: u.faceApproval === "pending" && u.facePhotoKey
      ? await storage().getSignedUrl(u.facePhotoKey as string, 300).catch(() => null)
      : null,
  })));
  return {
    rows,
    enrolled: rows.filter((r) => r.enrolled).length,
    /** What the count that matters is: faces a person has actually agreed to. */
    approved: rows.filter((r) => r.approval === "approved").length,
    pending: rows.filter((r) => r.approval === "pending").length,
    total: rows.length,
    settings: await faceSettings(ctx.companyId),
  };
}

/**
 * HR agrees, or does not, that the enrolled face belongs to the person (A120).
 *
 * This is the whole point of the feature. Without somebody who can recognise
 * the employee saying "yes, that is them", the check verifies a face against
 * whatever face was pointed at the camera first and then reports every later
 * swipe as verified - which is worse than having no check at all, because it
 * produces a record that looks like evidence.
 *
 * Turning one down clears the face rather than leaving it sitting there
 * rejected: the only useful next step is enrolling again, and a descriptor
 * nobody trusts has no reason to stay in the database.
 */
export async function decideEnrolment(
  ctx: CompanyContext,
  userId: string,
  input: { decision: "APPROVED" | "REJECTED"; note?: string | null },
  ip: string | null,
) {
  if (!Types.ObjectId.isValid(userId)) throw Errors.notFound("Employee");
  const _id = new Types.ObjectId(userId);
  const user = await scoped(User, ctx).findOne({ _id }).select("name faceApproval facePhotoKey").lean();
  if (!user) throw Errors.notFound("Employee");

  // Nobody approves their own face. The point is a second pair of eyes, and one
  // person being both of them is not a review.
  if (userId === ctx.userId) throw Errors.forbidden("Somebody else has to approve your own enrolment");
  if (user.faceApproval !== "pending") {
    throw Errors.bad("NOT_PENDING", "There is no enrolment waiting on a decision for this person");
  }

  const approved = input.decision === "APPROVED";
  const note = input.note?.trim() || null;

  await scoped(User, ctx).updateOne({ _id }, {
    $set: approved
      ? { faceApproval: "approved", faceApprovedBy: new Types.ObjectId(ctx.userId), faceApprovedAt: new Date(), faceReviewNote: note }
      : { faceApproval: "rejected", faceApprovedBy: new Types.ObjectId(ctx.userId), faceApprovedAt: new Date(), faceReviewNote: note, faceDescriptor: null, faceEnrolledAt: null, faceSamples: 0, facePhotoKey: null },
  });

  if (!approved && user.facePhotoKey) {
    await storage().delete(user.facePhotoKey as string).catch(() => {});
  }

  await audit({
    ctx, companyId: ctx.companyId, entity: "user", entityId: _id,
    action: approved ? "face.enrolment_approved" : "face.enrolment_rejected",
    summary: `${ctx.name} ${approved ? "approved" : "turned down"} ${user.name}'s face enrolment`,
    after: { decision: input.decision, note }, ip,
  });

  const { notify } = await import("./notificationService");
  await notify(ctx.companyId, {
    userId,
    type: approved ? "FACE_APPROVED" : "FACE_REJECTED",
    title: approved
      ? "Your face has been approved for attendance"
      : `Your face enrolment was turned down${note ? `: ${note}` : ""}`,
    link: "/profile",
    actorId: ctx.userId,
  });

  return { userId, approval: approved ? "approved" : "rejected" };
}

/** A short-lived link to the picture taken at enrolment, for whoever is reviewing it. */
export async function enrolmentPhotoUrl(ctx: CompanyContext, userId: string): Promise<string | null> {
  if (!Types.ObjectId.isValid(userId)) throw Errors.notFound("Employee");
  const { employeeScopeFilter } = await import("./scope");
  const user = await scoped(User, ctx).findOne({
    $and: [await employeeScopeFilter(ctx), { _id: new Types.ObjectId(userId) }],
  } as never).select("facePhotoKey").lean();
  if (!user?.facePhotoKey) return null;
  return storage().getSignedUrl(user.facePhotoKey as string, 300);
}

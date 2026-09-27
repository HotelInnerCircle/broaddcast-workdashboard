import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { User } from "@/models/User";
import { Company } from "@/models/Company";
import { averageDescriptors, compareFace, isDescriptor, DEFAULT_THRESHOLD, type FaceComparison } from "@/lib/face/match";
import type { CompanyContext } from "@/lib/auth/context";

export interface FaceSettings { enabled: boolean; threshold: number; maxRetries: number }

export async function faceSettings(companyId: string): Promise<FaceSettings> {
  const c = await Company.findById(companyId).select("faceCheck").lean();
  const f = (c?.faceCheck ?? {}) as Record<string, unknown>;
  return {
    // Off unless switched on: turning it on before people have enrolled would
    // stop everybody swiping.
    enabled: f.enabled === true,
    threshold: typeof f.threshold === "number" ? f.threshold : DEFAULT_THRESHOLD,
    maxRetries: typeof f.maxRetries === "number" ? f.maxRetries : 3,
  };
}

/**
 * Enrol a face from several captures.
 *
 * Several, not one: a single photograph carries whatever that moment happened to
 * be - a shadow, an odd angle - and the average is closer to the face than to
 * any one picture of it. Fewer false rejections later, for a few more seconds now.
 */
export async function enrolFace(ctx: CompanyContext, samples: unknown, ip: string | null) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw Errors.bad("NO_FACE", "No face was captured. Try again in better light.");
  }
  if (samples.length > 10) throw Errors.bad("TOO_MANY", "That is more captures than are needed");
  const good = samples.filter(isDescriptor);
  if (good.length < 2) {
    throw Errors.bad("NOT_ENOUGH", "Capture your face a few times so it can be recognised reliably.");
  }

  const descriptor = averageDescriptors(good);
  await scoped(User, ctx).updateOne(
    { _id: new Types.ObjectId(ctx.userId) },
    { $set: { faceDescriptor: descriptor, faceEnrolledAt: new Date(), faceSamples: good.length } },
  );
  await audit({
    ctx, companyId: ctx.companyId, entity: "user", entityId: new Types.ObjectId(ctx.userId),
    action: "face.enrolled", summary: `${ctx.name} enrolled their face for attendance`,
    after: { samples: good.length }, ip,
  });
  return { enrolled: true, samples: good.length, enrolledAt: new Date().toISOString() };
}

/** Forget an enrolled face. Kept simple and always available: it is their data. */
export async function forgetFace(ctx: CompanyContext, userId: string | null, ip: string | null) {
  const target = userId ?? ctx.userId;
  if (target !== ctx.userId && ctx.role !== "COMPANY_ADMIN" && ctx.role !== "HR") {
    throw Errors.forbidden("Only HR can remove somebody else's face");
  }
  const user = await scoped(User, ctx).findOne({ _id: new Types.ObjectId(target) }).select("name").lean();
  if (!user) throw Errors.notFound("Employee");
  await scoped(User, ctx).updateOne(
    { _id: new Types.ObjectId(target) },
    { $set: { faceDescriptor: null, faceEnrolledAt: null, faceSamples: 0 } },
  );
  await audit({
    ctx, companyId: ctx.companyId, entity: "user", entityId: new Types.ObjectId(target),
    action: "face.removed", summary: `${ctx.name} removed ${target === ctx.userId ? "their own" : user.name + "'s"} enrolled face`, ip,
  });
  return { removed: true };
}

export async function faceStatus(ctx: CompanyContext) {
  const [user, settings] = await Promise.all([
    scoped(User, ctx).findOne({ _id: new Types.ObjectId(ctx.userId) }).select("faceEnrolledAt faceSamples").lean(),
    faceSettings(ctx.companyId),
  ]);
  return {
    enrolled: Boolean(user?.faceEnrolledAt),
    enrolledAt: user?.faceEnrolledAt ? new Date(user.faceEnrolledAt as Date).toISOString() : null,
    samples: (user?.faceSamples as number | undefined) ?? 0,
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
    .select("+faceDescriptor").lean();
  const enrolled = (user?.faceDescriptor as number[] | null) ?? null;
  return { ...compareFace(captured, enrolled, settings.threshold), enabled: true };
}

/** Who has enrolled and who has not, for HR before switching the check on. */
export async function enrolmentRegister(ctx: CompanyContext) {
  const { employeeScopeFilter } = await import("./scope");
  const people = await scoped(User, ctx)
    .find({ $and: [await employeeScopeFilter(ctx), { archivedAt: null, status: { $ne: "deactivated" } }] } as never)
    .select("name employeeCode faceEnrolledAt faceSamples").sort({ name: 1 }).lean();
  const rows = people.map((u) => ({
    userId: String(u._id),
    userName: u.name as string,
    employeeCode: (u.employeeCode as string | null) ?? null,
    enrolled: Boolean(u.faceEnrolledAt),
    enrolledAt: u.faceEnrolledAt ? new Date(u.faceEnrolledAt as Date).toISOString() : null,
    samples: (u.faceSamples as number | undefined) ?? 0,
  }));
  return { rows, enrolled: rows.filter((r) => r.enrolled).length, total: rows.length, settings: await faceSettings(ctx.companyId) };
}

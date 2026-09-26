import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { storage, validateUpload, sniffMatches } from "@/lib/storage";
import { personClock } from "@/lib/time/company-clock";
import { notify, notifyMany } from "@/services/notificationService";
import { employeeScopeFilter, requireVisibleEmployee } from "@/services/scope";
import { buildChain, canDecide, approversFor } from "@/services/approvalChain";
import { LeaveRequest } from "@/models/LeaveRequest";
import { LeavePolicy } from "@/models/LeavePolicy";
import { User } from "@/models/User";
import { LEAVE_TYPES_WITH_BALANCE, LEAVE_TYPE_LABEL, type LeaveType } from "@/types";
import type { CompanyContext } from "@/lib/auth/context";
import type { LeaveCreateInput } from "@/lib/validation/leave";

export interface LeaveRow {
  id: string; userId: string; userName: string;
  type: LeaveType; typeLabel: string;
  startDate: string; endDate: string; days: number;
  note: string | null; attachmentUrl: string | null;
  status: string; currentStep: string | null;
  approvals: Array<{ step: string; decision: string; decidedByName: string | null; decidedAt: string | null; note: string | null }>;
  createdAt: string;
}

export interface BalanceRow {
  type: LeaveType; typeLabel: string;
  daysPerYear: number; monthlyAccrual: boolean;
  /** Entitlement earned so far this year. */
  accrued: number;
  taken: number; pending: number; remaining: number;
}

/** Working days in a range, against this person's shift and the company's holidays. */
async function workingDaysBetween(ctx: CompanyContext, userId: string, from: string, to: string): Promise<number> {
  const clock = await personClock(ctx.companyId, userId);
  return clock.days(from, to).filter((d) => clock.isWorkingDay(d)).length;
}

async function namesFor(ctx: CompanyContext, docs: Array<Record<string, unknown>>): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const d of docs) {
    ids.add(String(d.userId));
    for (const a of ((d.approvals as Array<Record<string, unknown>>) ?? [])) if (a.decidedBy) ids.add(String(a.decidedBy));
  }
  if (!ids.size) return new Map();
  const users = await scoped(User, ctx).find({ _id: { $in: [...ids].map((i) => new Types.ObjectId(i)) } }).select("name").lean();
  return new Map(users.map((u) => [String(u._id), u.name as string]));
}

async function serialize(d: Record<string, unknown>, names: Map<string, string>): Promise<LeaveRow> {
  const approvals = (d.approvals as Array<Record<string, unknown>>) ?? [];
  const idx = d.currentStep as number | null;
  const settled = d.status !== "PENDING";
  return {
    id: String(d._id),
    userId: String(d.userId),
    userName: names.get(String(d.userId)) ?? "Unknown",
    type: d.type as LeaveType,
    typeLabel: LEAVE_TYPE_LABEL[d.type as LeaveType],
    startDate: d.startDate as string,
    endDate: d.endDate as string,
    days: d.days as number,
    note: (d.note as string | null) ?? null,
    attachmentUrl: d.attachmentKey ? await storage().getSignedUrl(d.attachmentKey as string, 3600) : null,
    status: d.status as string,
    currentStep: !settled && idx !== null && approvals[idx] ? (approvals[idx].step as string) : null,
    approvals: approvals.map((a) => ({
      step: a.step as string,
      decision: a.decision as string,
      decidedByName: a.decidedBy ? (names.get(String(a.decidedBy)) ?? "Unknown") : null,
      decidedAt: a.decidedAt ? new Date(a.decidedAt as string).toISOString() : null,
      note: (a.note as string | null) ?? null,
    })),
    createdAt: new Date(d.createdAt as string).toISOString(),
  };
}

/**
 * What someone has, has taken and has left, per kind (A91).
 *
 * Accrual is monthly by default: in September you have earned nine twelfths of the year, not the
 * whole thing. Loss of pay and on duty carry no entitlement - they are recorded, not deducted.
 */
export async function leaveBalance(ctx: CompanyContext, userId: string, year?: number): Promise<BalanceRow[]> {
  const y = year ?? new Date().getFullYear();
  const [policies, taken] = await Promise.all([
    scoped(LeavePolicy, ctx).find({ year: y }).lean(),
    scoped(LeaveRequest, ctx).find({
      userId: new Types.ObjectId(userId),
      status: { $in: ["APPROVED", "PENDING"] },
      startDate: { $gte: `${y}-01-01`, $lte: `${y}-12-31` },
    }).select("type days status").lean(),
  ]);
  const byType = new Map(policies.map((p) => [p.type as LeaveType, p]));
  const monthsElapsed = y < new Date().getFullYear() ? 12 : y > new Date().getFullYear() ? 0 : new Date().getMonth() + 1;

  return LEAVE_TYPES_WITH_BALANCE.map((type) => {
    const p = byType.get(type);
    const daysPerYear = (p?.daysPerYear as number) ?? 0;
    const monthly = p?.monthlyAccrual !== false;
    const accrued = monthly ? Math.round(((daysPerYear / 12) * monthsElapsed) * 10) / 10 : daysPerYear;
    const mine = taken.filter((t) => t.type === type);
    const used = mine.filter((t) => t.status === "APPROVED").reduce((n, t) => n + (t.days as number), 0);
    const waiting = mine.filter((t) => t.status === "PENDING").reduce((n, t) => n + (t.days as number), 0);
    return {
      type, typeLabel: LEAVE_TYPE_LABEL[type],
      daysPerYear, monthlyAccrual: monthly, accrued,
      taken: used, pending: waiting,
      remaining: Math.round((accrued - used - waiting) * 10) / 10,
    };
  });
}

/** Submit a leave plan. It goes to the team lead, then the manager, then HR. */
export async function createLeave(
  ctx: CompanyContext,
  input: LeaveCreateInput,
  attachment: File | null,
  ip: string | null,
): Promise<LeaveRow> {
  if (input.endDate < input.startDate) throw Errors.bad("BAD_RANGE", "The end date is before the start date");
  const days = await workingDaysBetween(ctx, ctx.userId, input.startDate, input.endDate);
  if (days === 0) throw Errors.bad("NO_WORKING_DAYS", "That range has no working days in it - it is all weekend or holiday");

  const uid = new Types.ObjectId(ctx.userId);
  const overlap = await scoped(LeaveRequest, ctx).exists({
    userId: uid,
    status: { $in: ["PENDING", "APPROVED"] },
    startDate: { $lte: input.endDate },
    endDate: { $gte: input.startDate },
  });
  if (overlap) throw Errors.conflict("OVERLAPS", "You already have leave covering some of those days");

  // A balance-bearing type cannot be overdrawn; loss of pay exists precisely for that case.
  if (LEAVE_TYPES_WITH_BALANCE.includes(input.type)) {
    const bal = (await leaveBalance(ctx, ctx.userId)).find((b) => b.type === input.type);
    if (bal && bal.remaining < days) {
      throw Errors.bad("NO_BALANCE", `You have ${bal.remaining} day(s) of ${bal.typeLabel} left, and this asks for ${days}. Use Loss of Pay instead.`);
    }
  }

  let attachmentKey: string | null = null;
  if (attachment) {
    const { mime, ext } = validateUpload(attachment);
    const buf = Buffer.from(await attachment.arrayBuffer());
    if (!sniffMatches(buf, mime)) throw Errors.bad("BAD_FILE", "That file is not the type it claims to be");
    attachmentKey = `companies/${ctx.companyId}/leave/${crypto.randomUUID()}.${ext}`;
    await storage().put({ key: attachmentKey, body: buf, contentType: mime });
  }

  const steps = await buildChain(ctx, uid);
  const doc = await scoped(LeaveRequest, ctx).create({
    userId: uid, type: input.type, startDate: input.startDate, endDate: input.endDate, days,
    note: input.note ?? null, attachmentKey,
    status: "PENDING", currentStep: 0,
    approvals: steps.map((s) => ({ step: s.step, approverId: s.approverId, decision: "PENDING" })),
  });

  await tellStep(ctx, doc as never);
  await audit({ ctx, companyId: ctx.companyId, entity: "leaveRequest", entityId: doc._id, action: "leave.requested",
    summary: `${ctx.name} asked for ${days} day(s) of ${LEAVE_TYPE_LABEL[input.type]} (${input.startDate} to ${input.endDate})`,
    after: { type: input.type, startDate: input.startDate, endDate: input.endDate, days }, ip });

  const plain = doc.toObject() as Record<string, unknown>;
  return serialize(plain, await namesFor(ctx, [plain]));
}

/** Tells whoever it is now waiting on. */
async function tellStep(ctx: CompanyContext, doc: { _id: Types.ObjectId; userId: Types.ObjectId; currentStep: number | null; approvals: Array<{ step: string; approverId: Types.ObjectId | null }>; type: string; days: number }) {
  const idx = doc.currentStep;
  if (idx === null || idx === undefined) return;
  const step = doc.approvals[idx];
  if (!step) return;
  await notifyMany(ctx.companyId, await approversFor(ctx, step), {
    type: "ATTENDANCE_SWIPE",
    title: "Leave plan needs approval",
    body: `${ctx.name} asked for ${doc.days} day(s) of ${LEAVE_TYPE_LABEL[doc.type as LeaveType]}`,
    link: `/leave?id=${String(doc._id)}`,
    actorId: doc.userId,
  });
}

/** One step of the chain decides. Order is enforced: no step can be jumped. */
export async function decideLeave(
  ctx: CompanyContext,
  id: string,
  input: { decision: "APPROVED" | "REJECTED"; note?: string },
  ip: string | null,
): Promise<LeaveRow> {
  const doc = await scoped(LeaveRequest, ctx).findById(id);
  if (!doc) throw Errors.notFound("Leave plan");
  if (doc.status !== "PENDING" || doc.currentStep === null || doc.currentStep === undefined) {
    throw Errors.bad("ALREADY_SETTLED", "This leave plan has already been decided");
  }
  const step = doc.approvals[doc.currentStep];
  if (!step) throw Errors.bad("NO_STEP", "This leave plan has no step waiting");
  if (String(doc.userId) === ctx.userId) throw Errors.forbidden("You cannot decide your own leave");
  if (!canDecide(ctx, step, doc.userId)) throw Errors.forbidden("This leave plan is waiting on someone else");

  step.decision = input.decision;
  step.decidedBy = new Types.ObjectId(ctx.userId);
  step.decidedAt = new Date();
  step.note = input.note ?? null;

  if (input.decision === "REJECTED") {
    doc.status = "REJECTED"; doc.currentStep = null; doc.settledAt = new Date();
  } else if (doc.currentStep + 1 < doc.approvals.length) {
    doc.currentStep = doc.currentStep + 1;
  } else {
    doc.status = "APPROVED"; doc.currentStep = null; doc.settledAt = new Date();
  }
  await doc.save();

  if (doc.status === "PENDING") {
    await tellStep(ctx, doc as never);
  } else {
    await notify(ctx.companyId, {
      userId: String(doc.userId),
      type: "ATTENDANCE_SWIPE",
      title: doc.status === "APPROVED" ? "Leave approved" : "Leave rejected",
      body: `Your ${LEAVE_TYPE_LABEL[doc.type as LeaveType]} from ${doc.startDate} to ${doc.endDate} was ${doc.status.toLowerCase()} by ${ctx.name}`,
      link: "/leave",
      actorId: ctx.userId,
    });
  }

  await audit({ ctx, companyId: ctx.companyId, entity: "leaveRequest", entityId: doc._id, action: `leave.${input.decision.toLowerCase()}`,
    summary: `${ctx.name} ${input.decision === "APPROVED" ? "approved" : "rejected"} leave at the ${step.step.replace("_", " ").toLowerCase()} step`,
    after: { status: doc.status, step: step.step }, ip });

  const plain = doc.toObject() as Record<string, unknown>;
  return serialize(plain, await namesFor(ctx, [plain]));
}

/** Withdraw your own plan while it is still pending. */
export async function cancelLeave(ctx: CompanyContext, id: string, ip: string | null): Promise<LeaveRow> {
  const doc = await scoped(LeaveRequest, ctx).findById(id);
  if (!doc) throw Errors.notFound("Leave plan");
  if (String(doc.userId) !== ctx.userId) throw Errors.forbidden("That is not your leave plan");
  if (doc.status !== "PENDING") throw Errors.bad("ALREADY_SETTLED", "Only a pending plan can be withdrawn");
  doc.status = "CANCELLED"; doc.currentStep = null; doc.settledAt = new Date();
  await doc.save();
  await audit({ ctx, companyId: ctx.companyId, entity: "leaveRequest", entityId: doc._id, action: "leave.cancelled",
    summary: `${ctx.name} withdrew their leave plan`, after: { status: "CANCELLED" }, ip });
  const plain = doc.toObject() as Record<string, unknown>;
  return serialize(plain, await namesFor(ctx, [plain]));
}

/** Leave the caller may see. Employees see their own; leads, managers, HR and admins see their scope. */
export async function listLeave(
  ctx: CompanyContext,
  q: { status?: string; userId?: string; from?: string; to?: string; mine?: boolean; page: number; limit: number },
) {
  const visible = await scoped(User, ctx).find(await employeeScopeFilter(ctx)).select("_id").lean();
  const visibleIds = visible.map((v) => v._id as Types.ObjectId);

  const filter: Record<string, unknown> = { userId: { $in: visibleIds } };
  // Checked, not just assigned: plain assignment would replace the visible-ids
  // restriction above and hand over anybody's leave history.
  if (q.userId) filter.userId = await requireVisibleEmployee(ctx, q.userId);
  if (q.status) filter.status = q.status;
  if (q.from) filter.endDate = { $gte: q.from };
  if (q.to) filter.startDate = { $lte: q.to };

  if (q.mine) {
    filter.status = "PENDING";
    const or: Record<string, unknown>[] = [{ "approvals.approverId": new Types.ObjectId(ctx.userId) }];
    if (ctx.role === "HR" || ctx.role === "COMPANY_ADMIN") or.push({ "approvals.step": "HR" });
    filter.$or = or;
    if (ctx.role === "COMPANY_ADMIN" || ctx.role === "HR") delete filter.userId;
  }

  const total = await scoped(LeaveRequest, ctx).countDocuments(filter);
  const docs = await scoped(LeaveRequest, ctx).find(filter).sort({ startDate: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean();
  const plain = docs as Array<Record<string, unknown>>;
  const names = await namesFor(ctx, plain);
  return { data: await Promise.all(plain.map((d) => serialize(d, names))), page: q.page, limit: q.limit, total };
}

/** The entitlements HR has set for a year, defaulting every kind to zero until they say otherwise. */
export async function listPolicies(ctx: CompanyContext, year?: number) {
  const y = year ?? new Date().getFullYear();
  const rows = await scoped(LeavePolicy, ctx).find({ year: y }).lean();
  const by = new Map(rows.map((r) => [r.type as LeaveType, r]));
  return LEAVE_TYPES_WITH_BALANCE.map((type) => ({
    type, typeLabel: LEAVE_TYPE_LABEL[type], year: y,
    daysPerYear: (by.get(type)?.daysPerYear as number) ?? 0,
    monthlyAccrual: by.get(type)?.monthlyAccrual !== false,
  }));
}

export async function setPolicy(ctx: CompanyContext, input: { type: LeaveType; year: number; daysPerYear: number; monthlyAccrual?: boolean }, ip: string | null) {
  // The scoped helper deliberately has no upsert, so the tenant filter can never be bypassed.
  const existing = await scoped(LeavePolicy, ctx).findOne({ type: input.type, year: input.year });
  if (existing) {
    existing.daysPerYear = input.daysPerYear;
    existing.monthlyAccrual = input.monthlyAccrual ?? true;
    await existing.save();
  } else {
    await scoped(LeavePolicy, ctx).create({ ...input, monthlyAccrual: input.monthlyAccrual ?? true });
  }
  await audit({ ctx, companyId: ctx.companyId, entity: "leavePolicy", entityId: null, action: "leave_policy.set",
    summary: `${ctx.name} set ${LEAVE_TYPE_LABEL[input.type]} to ${input.daysPerYear} day(s) for ${input.year}`, after: input, ip });
  return listPolicies(ctx, input.year);
}

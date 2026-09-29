import { Types } from "mongoose";
import { compressImage } from "@/lib/storage/compress";
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
import { LEAVE_TYPES, LEAVE_TYPES_WITH_BALANCE, LEAVE_TYPE_LABEL, type LeaveType } from "@/types";
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
  /** Days brought forward from last year (A124). */
  carriedIn: number;
  /** Whether this kind is given to you at all, or only counted. */
  carriesBalance: boolean;
  /** The single number the balance screen shows. */
  figure: number;
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
 * What someone has, has taken and has left, per kind (A91, carried since A124).
 *
 * Accrual is monthly: a twelfth of the year's allowance lands at the start of
 * each month, so in September somebody has earned nine twelfths and not the
 * whole thing. Loss of pay and on duty carry no entitlement - they are
 * recorded, not deducted.
 *
 * Days nobody used do not vanish on the 1st of January. The balance is folded
 * forward year by year from the year the person joined: what was left at the
 * end of one year opens the next, capped where the policy caps it. Before this
 * every balance reset each January and a year of unused earned leave simply
 * disappeared - which is somebody's money, since it is owed when they leave.
 */
export async function leaveBalance(ctx: CompanyContext, userId: string, year?: number): Promise<BalanceRow[]> {
  const y = year ?? new Date().getFullYear();
  const uid = new Types.ObjectId(userId);
  /*
   * Every year at once, not just this one. Folding forward needs the whole
   * history, and fetching it in one query rather than one per year keeps this
   * to three round trips however long somebody has worked here.
   */
  const [allPolicies, allRequests, person] = await Promise.all([
    scoped(LeavePolicy, ctx).find({}).lean(),
    scoped(LeaveRequest, ctx).find({
      userId: uid,
      status: { $in: ["APPROVED", "PENDING"] },
    }).select("type days status startDate").lean(),
    scoped(User, ctx).findOne({ _id: uid }).select("joiningDate createdAt").lean(),
  ]);

  const policies = allPolicies.filter((p) => p.year === y);
  const taken = allRequests.filter((r) => String(r.startDate).slice(0, 4) === String(y));

  /*
   * Where to start folding from: the year they joined. Earlier years are not
   * theirs, and starting from the first policy the company ever wrote would
   * credit a new joiner with leave from before they arrived.
   */
  const joined = (person?.joiningDate ?? person?.createdAt) as Date | undefined;
  const firstYear = joined ? new Date(joined).getFullYear() : y;
  const byType = new Map(policies.map((p) => [p.type as LeaveType, p]));
  const thisYear = new Date().getFullYear();
  /*
   * A month's worth lands on the 1st, so January already holds one twelfth.
   * getMonth() is zero-based, which is what the +1 is doing.
   */
  const monthsIn = (forYear: number) => (forYear < thisYear ? 12 : forYear > thisYear ? 0 : new Date().getMonth() + 1);
  const monthsElapsed = monthsIn(y);

  /**
   * What each kind opens this year with: what was left at the end of last year,
   * as far back as the person's first year, capped where the policy caps it.
   *
   * Half days throughout, because that is the smallest leave anybody can take
   * and a carried balance has to be as bookable as a fresh one.
   */
  const openingFor = (type: LeaveType): number => {
    if (!LEAVE_TYPES_WITH_BALANCE.includes(type)) return 0;
    let carried = 0;
    for (let year = firstYear; year < y; year++) {
      const policy = allPolicies.find((p) => p.year === year && p.type === type);
      const perYear = (policy?.daysPerYear as number) ?? 0;
      const accruedThen = type === "COMP_OFF" ? 0
        : policy?.monthlyAccrual === false ? perYear
        : (perYear / 12) * monthsIn(year);
      const usedThen = allRequests
        .filter((r) => r.type === type && String(r.startDate).slice(0, 4) === String(year))
        .reduce((n, r) => n + (r.days as number), 0);
      const closing = Math.max(0, carried + accruedThen - usedThen);
      // Only what the policy lets through, and only if it lets anything.
      carried = policy?.carryForward
        ? (policy.carryForwardMax ? Math.min(closing, policy.carryForwardMax as number) : closing)
        : 0;
    }
    return Math.floor(carried * 2) / 2;
  };

  /*
   * Every kind, not only the four that carry an allowance (A123). Loss of pay
   * and on duty have nothing to run out of - they are recorded, never deducted -
   * but "how many days of unpaid leave have I had this year" is exactly the
   * question somebody opens this screen to answer, and leaving them off the list
   * meant the only place to find out was counting the history by hand.
   */
  return LEAVE_TYPES.map((type) => {
    const p = byType.get(type);
    const daysPerYear = (p?.daysPerYear as number) ?? 0;
    /*
     * Comp off is never earned by the calendar (A123). It is given for working a
     * day that was yours - a holiday, a weekend - so it accrues when somebody
     * grants it and at no other time. Accruing it monthly handed people days
     * off they had not worked for.
     */
    const monthly = type !== "COMP_OFF" && p?.monthlyAccrual !== false;
    /*
     * Rounded down to the half day, because that is the smallest leave anybody
     * can actually take (A123). One day a year, nine months in, is 0.75 - which
     * was shown as "0.8 days left" and meant nothing: there is no way to book
     * eight tenths of a day. Down rather than up, because rounding up hands out
     * leave that has not been earned yet, and somebody leaving in March would
     * be paid for it.
     */
    const opening = openingFor(type);
    const earned = monthly ? (daysPerYear / 12) * monthsElapsed : daysPerYear;
    const accrued = Math.floor((opening + earned) * 2) / 2;
    const mine = taken.filter((t) => t.type === type);
    const used = mine.filter((t) => t.status === "APPROVED").reduce((n, t) => n + (t.days as number), 0);
    const waiting = mine.filter((t) => t.status === "PENDING").reduce((n, t) => n + (t.days as number), 0);
    /*
     * What the number on the screen means differs by kind, so the row says
     * which: days left for the ones you are given, days used for the ones you
     * are not. A single "balance" column would have read 0.0 for somebody who
     * had taken fourteen days of unpaid leave.
     */
    const carriesBalance = LEAVE_TYPES_WITH_BALANCE.includes(type);
    return {
      type, typeLabel: LEAVE_TYPE_LABEL[type],
      daysPerYear, monthlyAccrual: monthly, accrued,
      /** Of the accrued figure, how much was brought in from last year. */
      carriedIn: opening,
      taken: used, pending: waiting,
      remaining: Math.floor((accrued - used - waiting) * 2) / 2,
      carriesBalance,
      /** The one figure to show: what is left, or what has been used. */
      figure: carriesBalance ? Math.floor((accrued - used - waiting) * 2) / 2 : used,
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
    const { mime } = validateUpload(attachment);
    const raw = Buffer.from(await attachment.arrayBuffer());
    if (!sniffMatches(raw, mime)) throw Errors.bad("BAD_FILE", "That file is not the type it claims to be");
    // A109: usually a photograph of a certificate. A PDF passes through untouched.
    const small = await compressImage(raw, mime, "attachment");
    attachmentKey = `companies/${ctx.companyId}/leave/${crypto.randomUUID()}.${small.ext}`;
    await storage().put({ key: attachmentKey, body: small.buffer, contentType: small.contentType });
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

export async function setPolicy(
  ctx: CompanyContext,
  input: { type: LeaveType; year: number; daysPerYear: number; monthlyAccrual?: boolean; carryForward?: boolean; carryForwardMax?: number },
  ip: string | null,
) {
  // The scoped helper deliberately has no upsert, so the tenant filter can never be bypassed.
  const existing = await scoped(LeavePolicy, ctx).findOne({ type: input.type, year: input.year });
  if (existing) {
    /*
     * Only what was actually sent (A124). This used to write
     * `monthlyAccrual ?? true` on every save, so changing the number of days
     * for comp off - which must never accrue by the calendar - quietly turned
     * accrual back on. A screen that sends one field should not decide the
     * others.
     */
    existing.daysPerYear = input.daysPerYear;
    if (input.monthlyAccrual !== undefined) existing.monthlyAccrual = input.monthlyAccrual;
    if (input.carryForward !== undefined) existing.carryForward = input.carryForward;
    if (input.carryForwardMax !== undefined) existing.carryForwardMax = input.carryForwardMax;
    await existing.save();
  } else {
    const fallback = DEFAULT_LEAVE_PLAN.find((d) => d.type === input.type);
    await scoped(LeavePolicy, ctx).create({
      ...input,
      monthlyAccrual: input.monthlyAccrual ?? fallback?.monthlyAccrual ?? true,
      carryForward: input.carryForward ?? fallback?.carryForward ?? false,
      carryForwardMax: input.carryForwardMax ?? fallback?.carryForwardMax ?? 0,
    });
  }
  await audit({ ctx, companyId: ctx.companyId, entity: "leavePolicy", entityId: null, action: "leave_policy.set",
    summary: `${ctx.name} set ${LEAVE_TYPE_LABEL[input.type]} to ${input.daysPerYear} day(s) for ${input.year}`, after: input, ip });
  return listPolicies(ctx, input.year);
}

/**
 * The leave a company starts with (A123).
 *
 * A new company had no policy at all, which meant every balance read zero and
 * somebody had to invent the numbers before anybody could book a day off. These
 * are the ordinary Indian allowances - they are a starting point, not a legal
 * opinion, and HR can change any of them on the leave policy screen.
 *
 * Comp off is deliberately zero and does not accrue: it is earned by working a
 * day that was yours, granted one at a time, not handed out by the calendar.
 */
export const DEFAULT_LEAVE_PLAN: Array<{ type: LeaveType; daysPerYear: number; monthlyAccrual: boolean; carryForward: boolean; carryForwardMax: number }> = [
  /*
   * Earned leave carries, capped (A124). It is earned by working and is owed in
   * money when somebody leaves, so letting it run away uncapped turns into a
   * liability nobody planned for - thirty days is the usual ceiling.
   */
  { type: "PL", daysPerYear: 15, monthlyAccrual: true, carryForward: true, carryForwardMax: 30 },
  // Casual and sick leave are meant to be used in the year they are given.
  { type: "CL", daysPerYear: 12, monthlyAccrual: true, carryForward: false, carryForwardMax: 0 },
  { type: "SL", daysPerYear: 12, monthlyAccrual: true, carryForward: false, carryForwardMax: 0 },
  // Comp off is granted for a day worked, one at a time, never by the calendar.
  { type: "COMP_OFF", daysPerYear: 0, monthlyAccrual: false, carryForward: false, carryForwardMax: 0 },
];

/**
 * Give a company the starting plan for a year, without touching anything
 * already set. Safe to run again: it only fills what is missing, so a company
 * that has decided on its own numbers keeps them.
 */
export async function seedLeavePlan(companyId: string, year: number): Promise<{ added: number }> {
  const cid = new Types.ObjectId(companyId);
  const existing = await LeavePolicy.find({ companyId: cid, year }).select("type").lean();
  const have = new Set(existing.map((p) => p.type as string));
  const missing = DEFAULT_LEAVE_PLAN.filter((d) => !have.has(d.type));
  if (missing.length === 0) return { added: 0 };
  await LeavePolicy.insertMany(missing.map((d) => ({ companyId: cid, year, ...d })));
  return { added: missing.length };
}

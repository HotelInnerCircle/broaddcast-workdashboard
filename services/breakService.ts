import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Break } from "@/models/Break";
import { TimeEntry } from "@/models/TimeEntry";
import { Errors, ApiError } from "@/lib/api/errors";
import { companyClock } from "@/lib/time/company-clock";
import { realtime } from "@/lib/realtime";
import type { CompanyContext } from "@/lib/auth/context";
import { closedSeconds, serializeEntry, TIMER_POPULATE } from "./timerService";

export function serializeBreak(b: Record<string, unknown>, now = new Date()) {
  const start = b.start as Date;
  const end = (b.end as Date | null) ?? null;
  return { id: String(b._id), userId: String(b.userId), start, end, date: b.date as string, durationSeconds: end ? (b.durationSeconds as number) : Math.floor((now.getTime() - start.getTime()) / 1000), resumeEntryId: b.resumeEntryId ? String(b.resumeEntryId) : null, autoClosed: Boolean((b.flags as { autoClosed?: boolean } | undefined)?.autoClosed) };
}

/** Starting a break auto-pauses a running timer and remembers it (spec 7.4). */
export async function startBreak(ctx: CompanyContext) {
  const uid = new Types.ObjectId(ctx.userId);
  const now = new Date();
  if (await scoped(Break, ctx).exists({ userId: uid, end: null })) throw new ApiError(409, "BREAK_ACTIVE", "You are already on a break", {});
  const active = await scoped(TimeEntry, ctx).findOne({ userId: uid, status: { $in: ["RUNNING", "PAUSED"] } });
  if (active && active.status === "RUNNING") {
    for (const s of active.segments as { start: Date; end: Date | null }[]) if (!s.end) s.end = now;
    active.status = "PAUSED";
    active.durationSeconds = closedSeconds(active.segments as never);
    await active.save();
  }
  const clock = await companyClock(ctx.companyId);
  let br;
  try {
    br = await scoped(Break, ctx).create({ userId: uid, start: now, end: null, durationSeconds: 0, date: clock.dayOf(now), resumeEntryId: active?._id ?? null });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new ApiError(409, "BREAK_ACTIVE", "You are already on a break", {});
    throw e;
  }
  realtime().emitToCompany(ctx.companyId, "break:started", { userId: ctx.userId, at: now });
  return { break: serializeBreak(br.toObject() as Record<string, unknown>, now), pausedEntryId: active ? String(active._id) : null };
}

/** Ending a break closes it and offers the previously paused task for one-click resume (spec 7.4). */
export async function endBreak(ctx: CompanyContext) {
  const uid = new Types.ObjectId(ctx.userId);
  const br = await scoped(Break, ctx).findOne({ userId: uid, end: null });
  if (!br) throw Errors.notFound("Open break");
  const now = new Date();
  br.end = now;
  br.durationSeconds = Math.max(0, Math.floor((now.getTime() - br.start.getTime()) / 1000));
  await br.save();
  realtime().emitToCompany(ctx.companyId, "break:ended", { userId: ctx.userId, at: now });
  const resume = br.resumeEntryId ? await scoped(TimeEntry, ctx).findOne({ _id: br.resumeEntryId, userId: uid, status: "PAUSED" }).populate(TIMER_POPULATE) : null;
  return { break: serializeBreak(br.toObject() as Record<string, unknown>, now), resumeEntry: resume ? serializeEntry(resume.toObject() as Record<string, unknown>, now) : null };
}

export async function listBreaks(ctx: CompanyContext, userId: string, from: string, to: string) {
  const rows = await scoped(Break, ctx).find({ userId: new Types.ObjectId(userId), date: { $gte: from, $lte: to } }).sort({ start: 1 }).lean();
  return rows.map((b) => serializeBreak(b as Record<string, unknown>));
}

import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Errors } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { Shift } from "@/models/Shift";
import { Holiday } from "@/models/Holiday";
import { User } from "@/models/User";
import type { CompanyContext } from "@/lib/auth/context";
import type { ShiftInput, ShiftPatchInput, HolidayInput } from "@/lib/validation/scheduling";

export interface ShiftRow {
  id: string; name: string; startTime: string; endTime: string;
  workingDays: string[]; lateThresholdMinutes: number; active: boolean;
  /** How many people are on it, so HR can see what a change will affect. */
  people: number;
  /** True when the shift runs past midnight. */
  overnight: boolean;
}
export interface HolidayRow { id: string; date: string; name: string }

const overnight = (start: string, end: string) => end <= start;

export async function listShifts(ctx: CompanyContext): Promise<ShiftRow[]> {
  const rows = await scoped(Shift, ctx).find({}).sort({ startTime: 1 }).lean();
  const counts = await scoped(User, ctx).aggregate([
    { $match: { shiftId: { $ne: null }, archivedAt: null } },
    { $group: { _id: "$shiftId", n: { $sum: 1 } } },
  ]);
  const by = new Map((counts as Array<{ _id: Types.ObjectId; n: number }>).map((c) => [String(c._id), c.n]));
  return rows.map((r) => ({
    id: String(r._id),
    name: r.name as string,
    startTime: r.startTime as string,
    endTime: r.endTime as string,
    workingDays: (r.workingDays as string[]) ?? [],
    lateThresholdMinutes: r.lateThresholdMinutes as number,
    active: Boolean(r.active),
    people: by.get(String(r._id)) ?? 0,
    overnight: overnight(r.startTime as string, r.endTime as string),
  }));
}

export async function createShift(ctx: CompanyContext, input: ShiftInput, ip: string | null): Promise<ShiftRow> {
  if (await scoped(Shift, ctx).exists({ name: input.name })) throw Errors.conflict("SHIFT_EXISTS", "A shift with this name already exists");
  const s = await scoped(Shift, ctx).create({ ...input, active: input.active ?? true, createdBy: new Types.ObjectId(ctx.userId) });
  await audit({ ctx, companyId: ctx.companyId, entity: "shift", entityId: s._id, action: "shift.created",
    summary: `${ctx.name} added the shift ${input.name} (${input.startTime}-${input.endTime})`, after: input, ip });
  return (await listShifts(ctx)).find((x) => x.id === String(s._id))!;
}

export async function updateShift(ctx: CompanyContext, id: string, input: ShiftPatchInput, ip: string | null): Promise<ShiftRow> {
  const s = await scoped(Shift, ctx).findById(id);
  if (!s) throw Errors.notFound("Shift");
  if (input.name && input.name !== s.name && (await scoped(Shift, ctx).exists({ name: input.name }))) {
    throw Errors.conflict("SHIFT_EXISTS", "A shift with this name already exists");
  }
  const before = { name: s.name, startTime: s.startTime, endTime: s.endTime, workingDays: s.workingDays, lateThresholdMinutes: s.lateThresholdMinutes, active: s.active };
  Object.assign(s, input);
  await s.save();
  await audit({ ctx, companyId: ctx.companyId, entity: "shift", entityId: s._id, action: "shift.updated", summary: `${ctx.name} updated the shift ${s.name}`, before, after: input, ip });
  return (await listShifts(ctx)).find((x) => x.id === String(s._id))!;
}

/** Removing a shift puts its people back on the company defaults rather than orphaning them. */
export async function deleteShift(ctx: CompanyContext, id: string, ip: string | null): Promise<{ moved: number }> {
  const s = await scoped(Shift, ctx).findById(id);
  if (!s) throw Errors.notFound("Shift");
  const moved = await scoped(User, ctx).updateMany({ shiftId: s._id }, { $set: { shiftId: null } });
  const name = s.name;
  await scoped(Shift, ctx).deleteOne({ _id: s._id });
  await audit({ ctx, companyId: ctx.companyId, entity: "shift", entityId: s._id, action: "shift.deleted",
    summary: `${ctx.name} deleted the shift ${name}; ${moved.modifiedCount} person(s) moved to the company hours`, before: { name }, ip });
  return { moved: moved.modifiedCount };
}

/** Put one person on a shift, or back on the company defaults with null. */
export async function assignShift(ctx: CompanyContext, userId: string, shiftId: string | null, ip: string | null): Promise<void> {
  const user = await scoped(User, ctx).findById(userId);
  if (!user) throw Errors.notFound("Employee");
  if (shiftId && !(await scoped(Shift, ctx).exists({ _id: new Types.ObjectId(shiftId), active: true }))) throw Errors.notFound("Shift");
  user.set("shiftId", shiftId ? new Types.ObjectId(shiftId) : null);
  await user.save();
  await audit({ ctx, companyId: ctx.companyId, entity: "user", entityId: user._id, action: "shift.assigned",
    summary: `${ctx.name} put ${user.name} on ${shiftId ? "a shift" : "the company hours"}`, after: { shiftId }, ip });
}

export async function listHolidays(ctx: CompanyContext, q: { from?: string; to?: string } = {}): Promise<HolidayRow[]> {
  const filter: Record<string, unknown> = {};
  if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const rows = await scoped(Holiday, ctx).find(filter).sort({ date: 1 }).lean();
  return rows.map((r) => ({ id: String(r._id), date: r.date as string, name: r.name as string }));
}

export async function createHoliday(ctx: CompanyContext, input: HolidayInput, ip: string | null): Promise<HolidayRow> {
  if (await scoped(Holiday, ctx).exists({ date: input.date })) throw Errors.conflict("HOLIDAY_EXISTS", "That date is already a holiday");
  const h = await scoped(Holiday, ctx).create({ ...input, createdBy: new Types.ObjectId(ctx.userId) });
  await audit({ ctx, companyId: ctx.companyId, entity: "holiday", entityId: h._id, action: "holiday.created", summary: `${ctx.name} added the holiday ${input.name} on ${input.date}`, after: input, ip });
  return { id: String(h._id), date: input.date, name: input.name };
}

export async function deleteHoliday(ctx: CompanyContext, id: string, ip: string | null): Promise<void> {
  const h = await scoped(Holiday, ctx).findById(id);
  if (!h) throw Errors.notFound("Holiday");
  const { date, name } = h;
  await scoped(Holiday, ctx).deleteOne({ _id: h._id });
  await audit({ ctx, companyId: ctx.companyId, entity: "holiday", entityId: h._id, action: "holiday.deleted", summary: `${ctx.name} removed the holiday ${name} on ${date}`, before: { date, name }, ip });
}

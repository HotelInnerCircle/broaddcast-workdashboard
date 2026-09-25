import { Types } from "mongoose";
import { Company } from "@/models/Company";
import { User } from "@/models/User";
import { Errors } from "@/lib/api/errors";
import type { CompanyContext } from "@/lib/auth/context";

/**
 * The next employee code for a company (A95).
 *
 * The counter lives on the company and is handed out with `findOneAndUpdate` + `$inc`, which
 * MongoDB applies atomically - two people added in the same second cannot be given the same
 * number. Doing it as "count the users and add one" would do exactly that under any concurrency,
 * and would also reuse the code of anyone deleted.
 */
export async function nextEmployeeCode(companyId: string): Promise<string> {
  const company = await Company.findByIdAndUpdate(
    new Types.ObjectId(companyId),
    { $inc: { employeeCodeNext: 1 } },
    { new: false, projection: "employeeCodePrefix employeeCodePadding employeeCodeNext" },
  ).lean();
  if (!company) throw Errors.notFound("Company");
  const prefix = (company.employeeCodePrefix as string) ?? "EMP";
  const padding = (company.employeeCodePadding as number) ?? 3;
  const n = (company.employeeCodeNext as number) ?? 1;
  return `${prefix}${String(n).padStart(padding, "0")}`;
}

/** Refuses a code somebody else in the company already has. */
export async function assertCodeFree(ctx: CompanyContext, code: string, exceptUserId?: string): Promise<void> {
  const clash = await User.findOne({
    companyId: new Types.ObjectId(ctx.companyId),
    employeeCode: code,
    ...(exceptUserId ? { _id: { $ne: new Types.ObjectId(exceptUserId) } } : {}),
  }).select("_id").lean();
  if (clash) throw Errors.conflict("CODE_TAKEN", `${code} is already used by someone else`);
}

/**
 * Gives a code to everyone in the company who has none, oldest first so the numbering follows the
 * order people actually joined. Safe to run repeatedly - it only touches those still missing one.
 */
export async function backfillEmployeeCodes(ctx: CompanyContext): Promise<{ assigned: number }> {
  const missing = await User.find({
    companyId: new Types.ObjectId(ctx.companyId),
    $or: [{ employeeCode: null }, { employeeCode: { $exists: false } }],
  }).select("_id").sort({ createdAt: 1 }).lean();

  let assigned = 0;
  for (const m of missing) {
    const code = await nextEmployeeCode(ctx.companyId);
    await User.updateOne({ _id: m._id, employeeCode: null }, { $set: { employeeCode: code } });
    assigned++;
  }
  return { assigned };
}

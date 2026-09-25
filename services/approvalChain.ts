import { Types } from "mongoose";
import { scoped } from "@/lib/db/scoped";
import { Team } from "@/models/Team";
import { User } from "@/models/User";
import type { CompanyContext } from "@/lib/auth/context";

export const APPROVAL_STEPS = ["TEAM_LEAD", "MANAGER", "HR"] as const;
export type ApprovalStep = (typeof APPROVAL_STEPS)[number];
export interface ChainStep { step: ApprovalStep; approverId: Types.ObjectId | null }

/**
 * Who has to agree, in order (A83, shared with leave in A91).
 *
 * A step is only added when there is a distinct person to fill it: a team lead does not approve
 * their own request, and somebody with no manager does not wait forever for one. The HR step is
 * always present and always settleable - any HR may act, and a Company Admin may act on any step -
 * so a pending request can never be stranded with nobody able to decide it.
 */
export async function buildChain(ctx: CompanyContext, userId: Types.ObjectId): Promise<ChainStep[]> {
  const user = await scoped(User, ctx).findById(String(userId)).select("teamId managerId").lean();
  const team = user?.teamId ? await scoped(Team, ctx).findById(String(user.teamId)).select("leadId managerId").lean() : null;

  const steps: ChainStep[] = [];
  const isSelf = (id: unknown) => id && String(id) === String(userId);

  if (team?.leadId && !isSelf(team.leadId)) steps.push({ step: "TEAM_LEAD", approverId: team.leadId as Types.ObjectId });
  const managerId = user?.managerId ?? team?.managerId ?? null;
  if (managerId && !isSelf(managerId)) steps.push({ step: "MANAGER", approverId: managerId as Types.ObjectId });
  steps.push({ step: "HR", approverId: null });
  return steps;
}

/**
 * May this person decide the step a request is currently sitting at?
 *
 * The named approver for that step; any HR when the step is HR; and a Company Admin on any step,
 * because they own the company and are the reason a request can always be settled. Nobody decides
 * their own request, whatever their role.
 */
export function canDecide(ctx: CompanyContext, step: { step: string; approverId?: Types.ObjectId | null }, ownerId: unknown): boolean {
  if (String(ownerId) === ctx.userId) return false;
  if (ctx.role === "COMPANY_ADMIN") return true;
  if (step.step === "HR" && ctx.role === "HR") return true;
  return Boolean(step.approverId) && String(step.approverId) === ctx.userId;
}

/** Everyone who should be told a request is now waiting on them. */
export async function approversFor(ctx: CompanyContext, step: { step: string; approverId?: Types.ObjectId | null }): Promise<string[]> {
  if (step.approverId) return [String(step.approverId)];
  const people = await scoped(User, ctx)
    .find({ role: { $in: ["HR", "COMPANY_ADMIN"] }, status: "active", archivedAt: null })
    .select("_id").lean();
  return people.map((p) => String(p._id));
}

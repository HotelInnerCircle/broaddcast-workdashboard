import { z } from "zod";
import { LEAVE_TYPES } from "@/types";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date");

/** Multipart, because a leave plan may carry proof - so numbers arrive as strings. */
export const leaveCreateSchema = z.object({
  type: z.enum(LEAVE_TYPES),
  startDate: day,
  endDate: day,
  note: z.string().trim().max(500).optional(),
});
export type LeaveCreateInput = z.infer<typeof leaveCreateSchema>;

export const leaveDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(300).optional(),
});

export const leaveQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  userId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  /** Only what is waiting on the caller to decide. */
  mine: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const leavePolicySchema = z.object({
  type: z.enum(LEAVE_TYPES),
  year: z.coerce.number().int().min(2000).max(2100),
  daysPerYear: z.coerce.number().min(0).max(365),
  monthlyAccrual: z.boolean().optional(),
});

import { z } from "zod";
import { objectId } from "./common";
import { TIME_ENTRY_STATUSES } from "@/types";

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Work notes are mandatory when a person stops a timer: they describe what was completed (A53). */
export const workNotes = z.string({ error: "Describe the work you completed" }).trim().min(3, "Describe the work you completed (at least 3 characters)").max(1000);

/** Timers start on a client with notes on what is being worked on (A58); project/task are attached only from a task page. */
export const startTimerSchema = z.object({
  clientId: objectId,
  projectId: objectId.optional(),
  taskId: objectId.optional(),
  notes: workNotes,
  force: z.boolean().optional(),
  /** Required when `force` closes a running timer: the notes for that closed entry. */
  previousNotes: workNotes.optional(),
});
export const stopTimerSchema = z.object({ notes: workNotes });

export const timesheetQuerySchema = z.object({
  from: dayKey, to: dayKey,
  userId: objectId.optional(), teamId: objectId.optional(), clientId: objectId.optional(), projectId: objectId.optional(), taskId: objectId.optional(),
  status: z.enum(TIME_ENTRY_STATUSES).optional(),
}).refine((v) => v.from <= v.to, { message: "from must be before to", path: ["from"] });

export const attendanceQuerySchema = z.object({ from: dayKey, to: dayKey, userId: objectId.optional(), flagged: z.enum(["true", "false"]).optional() })
  .refine((v) => v.from <= v.to, { message: "from must be before to", path: ["from"] });

export const setLeaveSchema = z.object({ userId: objectId, date: dayKey, note: z.string().trim().max(300).nullable().optional() });

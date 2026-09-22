import { z } from "zod";
import { PRIORITIES, TASK_STATUSES } from "@/types";
import { dateInput, objectId } from "./common";

export const createTaskSchema = z.object({
  projectId: objectId,
  title: z.string().trim().min(2, "Title is too short").max(200),
  description: z.string().trim().max(10000).nullable().optional().transform((v) => (v ? v : null)),
  assignedTo: objectId.nullable().optional(),
  priority: z.enum(PRIORITIES).default("Medium"),
  status: z.enum(TASK_STATUSES).optional(),
  dueDate: dateInput,
  estimatedMinutes: z.number().int().min(0).max(100000).nullable().optional(),
});
/** Explicit (no defaults) so an absent key stays absent: employees may send { status } alone. */
export const updateTaskSchema = z.object({
  title: z.string().trim().min(2, "Title is too short").max(200).optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  assignedTo: objectId.nullable().optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  dueDate: dateInput,
  estimatedMinutes: z.number().int().min(0).max(100000).nullable().optional(),
  archived: z.boolean().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const listTasksSchema = z.object({
  q: z.string().trim().max(100).optional(),
  projectId: objectId.optional(),
  clientId: objectId.optional(),
  assignedTo: objectId.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  mine: z.enum(["true", "false"]).optional(),
  overdue: z.enum(["true", "false"]).optional(),
  dueFrom: z.coerce.date().optional(),
  dueTo: z.coerce.date().optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

export const calendarQuerySchema = z.object({ from: z.coerce.date(), to: z.coerce.date() });

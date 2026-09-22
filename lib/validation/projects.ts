import { z } from "zod";
import { PRIORITIES, PROJECT_STATUSES } from "@/types";
import { dateInput, objectId } from "./common";

const nullableDate = dateInput;

export const createProjectSchema = z.object({
  clientId: objectId,
  name: z.string().trim().min(2, "Project name is too short").max(140),
  description: z.string().trim().max(5000).nullable().optional().transform((v) => (v ? v : null)),
  managerId: objectId.nullable().optional(),
  memberIds: z.array(objectId).max(200).default([]),
  startDate: nullableDate,
  deadline: nullableDate,
  status: z.enum(PROJECT_STATUSES).default("Planning"),
  priority: z.enum(PRIORITIES).default("Medium"),
  budget: z.number().min(0).nullable().optional(),
  estimatedHours: z.number().min(0).max(100000).nullable().optional(),
});
export const updateProjectSchema = z.object({
  clientId: objectId.optional(),
  name: z.string().trim().min(2, "Project name is too short").max(140).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  managerId: objectId.nullable().optional(),
  memberIds: z.array(objectId).max(200).optional(),
  startDate: nullableDate,
  deadline: nullableDate,
  status: z.enum(PROJECT_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  budget: z.number().min(0).nullable().optional(),
  estimatedHours: z.number().min(0).max(100000).nullable().optional(),
  archived: z.boolean().optional(),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const listProjectsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  clientId: objectId.optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

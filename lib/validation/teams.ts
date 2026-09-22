import { z } from "zod";
import { objectId } from "./common";

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  leadId: objectId.nullable().optional(),
  managerId: objectId.nullable().optional(),
});
export const updateTeamSchema = createTeamSchema.partial().extend({ archived: z.boolean().optional() });
export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

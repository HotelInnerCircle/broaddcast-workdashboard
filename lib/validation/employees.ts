import { z } from "zod";
import { COMPANY_ROLES } from "@/types";
import { email, objectId, password, personName } from "./common";

export const createInviteSchema = z.object({
  email,
  role: z.enum(COMPANY_ROLES),
  teamId: objectId.nullable().optional(),
  managerId: objectId.nullable().optional(),
  designation: z.string().trim().max(60).nullable().optional(),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

/** Direct account creation (A56): the admin sets name + password and hands the credentials over; no invite email. */
export const createEmployeeSchema = createInviteSchema.extend({ name: personName, password });
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object({
  name: personName.optional(),
  role: z.enum(COMPANY_ROLES).optional(),
  teamId: objectId.nullable().optional(),
  managerId: objectId.nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  department: z.string().trim().max(80).nullable().optional(),
  designation: z.string().trim().max(60).nullable().optional(),
  joiningDate: z.coerce.date().nullable().optional(),
  status: z.enum(["active", "deactivated"]).optional(),
});
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const listEmployeesSchema = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(COMPANY_ROLES).optional(),
  status: z.enum(["active", "invited", "deactivated"]).optional(),
  teamId: objectId.optional(),
});

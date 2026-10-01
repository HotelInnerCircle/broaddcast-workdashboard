import { z } from "zod";
import { COMPANY_ROLES } from "@/types";
import { email, objectId, password, personName } from "./common";
import { grossOfInput, salaryFields } from "./payroll";

export const createInviteSchema = z.object({
  email,
  /** A95: leave it out and the next code in sequence is used. */
  employeeCode: z.string().trim().max(24).nullable().optional(),
  role: z.enum(COMPANY_ROLES),
  teamId: objectId.nullable().optional(),
  managerId: objectId.nullable().optional(),
  designation: z.string().trim().max(60).nullable().optional(),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

/**
 * Direct account creation (A56): the admin sets name + password and hands the
 * credentials over; no invite email.
 *
 * Pay is part of it (A138). The separate salary register is gone: what somebody
 * earns is agreed when they are hired, so it is asked for while they are being
 * added rather than on another screen afterwards. Still optional - somebody can
 * be given a login before the figure is settled - and refused outright if every
 * amount is zero, because a scale adding up to nothing is a mistake, not a wage.
 */
export const createEmployeeSchema = createInviteSchema.extend({
  name: personName,
  password,
  salary: salaryFields
    .refine((s) => grossOfInput(s) > 0, { message: "A salary needs at least one amount on it" })
    .nullable()
    .optional(),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = z.object({
  name: personName.optional(),
  role: z.enum(COMPANY_ROLES).optional(),
  /** A90: the working pattern this person is on; null puts them back on the company hours. */
  shiftId: objectId.nullable().optional(),
  /** A93: which office or site this person belongs to. */
  branch: z.string().trim().max(80).nullable().optional(),
  employeeCode: z.string().trim().max(24).nullable().optional(),
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

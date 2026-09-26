import { z } from "zod";
import { WEEKDAYS } from "@/types";
import { email, hhmm, password, personName } from "./common";

export const updateCompanySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  workingHours: z.object({ start: hhmm, end: hhmm }).optional(),
  workingDays: z.array(z.enum(WEEKDAYS)).min(1).optional(),
  lateThresholdMinutes: z.number().int().min(0).max(240).optional(),
  defaultTaskStatus: z.string().trim().max(40).optional(),
  /** A95: how employee codes are built. Changing these affects the next one issued, not past ones. */
  employeeCodePrefix: z.string().trim().max(8).optional(),
  employeeCodePadding: z.number().int().min(1).max(8).optional(),
  payrollStartDay: z.number().int().min(1).max(31).optional(),
  designations: z.array(z.string().trim().min(1, "Designation cannot be empty").max(60)).max(100).optional(),
  services: z.array(z.string().trim().min(1, "Service cannot be empty").max(60)).max(100).optional(),
  hiddenNav: z.object({
    COMPANY_ADMIN: z.array(z.string()).max(60),
    HR: z.array(z.string()).max(60),
    MANAGER: z.array(z.string()).max(60),
    TEAM_LEAD: z.array(z.string()).max(60),
    EMPLOYEE: z.array(z.string()).max(60),
  }).partial().optional(),
  setupCompleted: z.boolean().optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

/**
 * What a person may change about themselves (A93).
 *
 * Deliberately excludes designation, department, branch and joining date: those are employment
 * facts HR owns, and someone editing their own job title is not a feature. `updateRequest` is how
 * they ask for one of those to be corrected.
 */
export const updateProfileSchema = z.object({
  name: personName.optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).nullable().optional(),
  maritalStatus: z.enum(["single", "married", "other", "prefer_not_to_say"]).nullable().optional(),
  dateOfBirth: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "Pick a date").nullable().optional(),
  address: z.string().trim().max(400).nullable().optional(),
  emergencyContact: z.object({
    name: z.string().trim().max(120).nullable().optional(),
    relation: z.string().trim().max(60).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
  }).optional(),
  updateRequest: z.string().trim().max(500).nullable().optional(),
  notificationPrefs: z.object({ email: z.boolean(), inApp: z.boolean() }).partial().optional(),
});

export const superAdminCompanyPatchSchema = z.object({
  status: z.enum(["active", "suspended"]).optional(),
  planId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  reason: z.string().trim().max(300).optional(),
});

/** Super Admin creates a company and invites its first administrator (A55). */
export const createCompanySchema = z.object({
  name: z.string().trim().min(2, "Company name is too short").max(120),
  adminName: personName,
  adminEmail: email,
  /** Optional (A56): when set, the admin account is active immediately with this password and no invite is sent. */
  adminPassword: password.optional(),
  planId: z.string().regex(/^[a-f\d]{24}$/i).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
});
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;

/** Deleting a company is irreversible: the caller must type the exact company name (A55). */
export const deleteCompanySchema = z.object({ confirmName: z.string().trim().min(1, "Type the company name to confirm") });

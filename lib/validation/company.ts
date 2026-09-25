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

export const updateProfileSchema = z.object({
  name: personName.optional(),
  phone: z.string().trim().max(30).nullable().optional(),
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

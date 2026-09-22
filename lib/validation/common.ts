import { z } from "zod";

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
export const email = z.string().trim().email("Enter a valid email address").max(254).transform((v) => v.toLowerCase());
export const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain a letter")
  .regex(/\d/, "Password must contain a number");
export const personName = z.string().trim().min(2, "Name is too short").max(120);
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

/**
 * A date field: either a date-only string (YYYY-MM-DD, interpreted later as midnight in the
 * company timezone via parseDateInput) or a full timestamp. Null clears the field.
 */
export const dateInput = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"), z.coerce.date()]).nullable().optional();

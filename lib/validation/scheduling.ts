import { z } from "zod";
import { WEEKDAYS } from "@/types";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 09:00");

/** A working pattern HR puts people on (A90). */
export const shiftSchema = z.object({
  name: z.string().trim().min(2, "Give the shift a name").max(60),
  startTime: hhmm,
  endTime: hhmm,
  workingDays: z.array(z.enum(WEEKDAYS)).min(1, "Pick at least one working day"),
  lateThresholdMinutes: z.number().int().min(0).max(240),
  active: z.boolean().optional(),
});
export type ShiftInput = z.infer<typeof shiftSchema>;

/** Written out by hand, not `.partial()`: renaming a shift must not silently empty its days. */
export const shiftPatchSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  startTime: hhmm.optional(),
  endTime: hhmm.optional(),
  workingDays: z.array(z.enum(WEEKDAYS)).min(1).optional(),
  lateThresholdMinutes: z.number().int().min(0).max(240).optional(),
  active: z.boolean().optional(),
});
export type ShiftPatchInput = z.infer<typeof shiftPatchSchema>;

export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  name: z.string().trim().min(2, "Name the holiday").max(80),
});
export type HolidayInput = z.infer<typeof holidaySchema>;

export const holidayQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

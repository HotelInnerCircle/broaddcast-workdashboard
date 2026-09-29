import { z } from "zod";

/** Approving or turning down a face enrolment (A120). */
export const faceDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  /** Why, for a rejection. The person has to be told something they can act on. */
  note: z.string().trim().max(300).nullable().optional(),
});

/** The face-check settings a company admin can change. */
export const faceSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  threshold: z.number().min(0.1).max(1.5).optional(),
  maxRetries: z.number().int().min(1).max(10).optional(),
  enrolAtSite: z.boolean().optional(),
});

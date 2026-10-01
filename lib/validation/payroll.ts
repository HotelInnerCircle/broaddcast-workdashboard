import { z } from "zod";
import { objectId } from "./common";

const money = z.number().min(0).max(100_000_000);
const day = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "Use a date like 2026-04-01");

/**
 * A pay scale on its own, without saying whose it is (A138).
 *
 * Split out because a salary is now set in two places - on somebody's own page
 * and while they are being created - and both have to mean the same thing. One
 * schema, so a figure accepted in one is accepted in the other.
 */
export const salaryFields = z.object({
  effectiveFrom: day,
  basic: money,
  hra: money.optional(),
  conveyance: money.optional(),
  lta: money.optional(),
  special: money.optional(),
  note: z.string().max(200).nullish(),
});

export const salarySchema = salaryFields.extend({ userId: objectId });

/** The parts that add up to the monthly gross - `note` and the date are not money. */
export const grossOfInput = (s: z.infer<typeof salaryFields>) =>
  (s.basic || 0) + (s.hra || 0) + (s.conveyance || 0) + (s.lta || 0) + (s.special || 0);

export const generateSchema = z.object({
  userId: objectId.optional(),
  month: z.string().regex(/^[0-9]{4}-[0-9]{2}$/).optional(),
  publish: z.boolean().optional(),
  adjustments: z.object({
    tds: money.optional(),
    latePenalty: money.optional(),
    advance: money.optional(),
    otherEarnings: money.optional(),
    otherEarningsLabel: z.string().max(60).nullish(),
  }).optional(),
});

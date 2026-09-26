import { z } from "zod";
import { objectId } from "./common";

const money = z.number().min(0).max(100_000_000);
const day = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "Use a date like 2026-04-01");

export const salarySchema = z.object({
  userId: objectId,
  effectiveFrom: day,
  basic: money,
  hra: money.optional(),
  conveyance: money.optional(),
  lta: money.optional(),
  special: money.optional(),
  note: z.string().max(200).nullish(),
});

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

import { z } from "zod";
import { objectId } from "./common";

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Shared report filters (spec 12.18): date range, employee, team, client, project. */
export const reportFilterSchema = z.object({
  from: dayKey, to: dayKey,
  userId: objectId.optional(), teamId: objectId.optional(), clientId: objectId.optional(), projectId: objectId.optional(),
  format: z.enum(["json", "csv", "xlsx", "pdf"]).default("json"),
}).refine((v) => v.from <= v.to, { message: "from must be before to", path: ["from"] });
export type ReportFilter = z.infer<typeof reportFilterSchema>;

const text = z.string().trim().max(4000);
export const dailyReportSchema = z.object({
  date: dayKey.optional(),
  completed: text,
  // Removed from the form (A68); still accepted so older clients and stored data keep working.
  inProgress: text.optional(), pending: text.optional(), blockers: text.optional(), tomorrow: text.optional(),
});
export const dailyReportQuerySchema = z.object({ date: dayKey.optional(), from: dayKey.optional(), to: dayKey.optional(), userId: objectId.optional(), teamId: objectId.optional(), status: z.enum(["submitted", "missing"]).optional(), format: z.enum(["json", "csv", "xlsx", "pdf"]).default("json") });

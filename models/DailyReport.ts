import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

/** Daily work report (spec 12.17): one per user per company-timezone day. */
const DailyReportSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: String, required: true },
    completed: { type: String, default: "" },
    inProgress: { type: String, default: "" },
    pending: { type: String, default: "" },
    blockers: { type: String, default: "" },
    tomorrow: { type: String, default: "" },
    submittedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true },
);
DailyReportSchema.plugin(tenantGuardPlugin);
DailyReportSchema.index({ companyId: 1, userId: 1, date: 1 }, { unique: true });
DailyReportSchema.index({ companyId: 1, date: 1 });

export type DailyReportDoc = InferSchemaType<typeof DailyReportSchema> & { companyId: Types.ObjectId };
export const DailyReport = (models.DailyReport as Model<DailyReportDoc>) ?? model<DailyReportDoc>("DailyReport", DailyReportSchema);

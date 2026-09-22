import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

/** Breaks (spec 7.4). `resumeEntryId` remembers the timer that was auto-paused so the UI can offer to resume it. */
const BreakSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    start: { type: Date, required: true },
    end: { type: Date, default: null },
    durationSeconds: { type: Number, default: 0 },
    date: { type: String, required: true },
    resumeEntryId: { type: Schema.Types.ObjectId, ref: "TimeEntry", default: null },
    flags: { autoClosed: { type: Boolean, default: false } },
  },
  { timestamps: true },
);
BreakSchema.plugin(tenantGuardPlugin);
BreakSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { end: null }, name: "one_open_break_per_user" });
BreakSchema.index({ companyId: 1, userId: 1, date: 1 });
BreakSchema.index({ companyId: 1, date: 1 });

export type BreakDoc = InferSchemaType<typeof BreakSchema> & { companyId: Types.ObjectId };
export const Break = (models.Break as Model<BreakDoc>) ?? model<BreakDoc>("Break", BreakSchema);

import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";
import { WEEKDAYS } from "@/types";

/**
 * A working pattern HR can put people on (A90): when the day starts and ends, which days count,
 * and how much lateness is tolerated. Without one, a person falls back to the company defaults in
 * Settings, so this is an override rather than a requirement.
 *
 * `endTime` before `startTime` means the shift crosses midnight - a night shift - which the clock
 * has to know about before it can decide whether somebody was late.
 */
const ShiftSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true },
    workingDays: { type: [String], enum: WEEKDAYS, default: ["mon", "tue", "wed", "thu", "fri"] },
    lateThresholdMinutes: { type: Number, default: 10, min: 0, max: 240 },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
ShiftSchema.plugin(tenantGuardPlugin);
ShiftSchema.index({ companyId: 1, name: 1 }, { unique: true });
ShiftSchema.index({ companyId: 1, active: 1 });

export type ShiftDoc = InferSchemaType<typeof ShiftSchema> & { companyId: Types.ObjectId };
export const Shift = (models.Shift as Model<ShiftDoc>) ?? model<ShiftDoc>("Shift", ShiftSchema);

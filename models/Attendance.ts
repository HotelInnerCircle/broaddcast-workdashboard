import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";
import { ATTENDANCE_STATUSES } from "@/types";

/** Attendance (spec 7.5). One record per user per company-timezone day. */
const AttendanceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: String, required: true },
    clockIn: { type: Date, default: null },
    clockOut: { type: Date, default: null },
    breakSeconds: { type: Number, default: 0 },
    workSeconds: { type: Number, default: 0 },
    status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
    flags: { autoClosed: { type: Boolean, default: false }, reviewed: { type: Boolean, default: false } },
    note: { type: String, default: null },
    setBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
AttendanceSchema.plugin(tenantGuardPlugin);
AttendanceSchema.index({ companyId: 1, userId: 1, date: 1 }, { unique: true });
AttendanceSchema.index({ companyId: 1, date: 1 });
AttendanceSchema.index({ companyId: 1, status: 1 });
AttendanceSchema.index({ companyId: 1, "flags.autoClosed": 1 });

export type AttendanceDoc = InferSchemaType<typeof AttendanceSchema> & { companyId: Types.ObjectId };
export const Attendance = (models.Attendance as Model<AttendanceDoc>) ?? model<AttendanceDoc>("Attendance", AttendanceSchema);

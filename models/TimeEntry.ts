import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";
import { TIME_ENTRY_STATUSES } from "@/types";

const SegmentSchema = new Schema({ start: { type: Date, required: true }, end: { type: Date, default: null } }, { _id: false });

/** Timer = segments (spec 7.1). Durations derive from server timestamps only. Timers run against a client (A58); projectId and taskId are optional and set only when started from a task. */
const TimeEntrySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", default: null },
    segments: { type: [SegmentSchema], default: [] },
    status: { type: String, enum: TIME_ENTRY_STATUSES, required: true },
    durationSeconds: { type: Number, default: 0 },
    /** Day key (yyyy-MM-dd) of the first segment start in the company timezone. */
    date: { type: String, required: true },
    /** Mandatory for user-stopped entries: describes the work completed (A53). Null only on system auto-close. */
    notes: { type: String, default: null },
    flags: { autoClosed: { type: Boolean, default: false } },
  },
  { timestamps: true },
);
TimeEntrySchema.plugin(tenantGuardPlugin);
/** One active timer per employee, enforced in the database (spec 7.2). */
TimeEntrySchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: { $in: ["RUNNING", "PAUSED"] } }, name: "one_active_timer_per_user" });
TimeEntrySchema.index({ companyId: 1, userId: 1, date: 1 });
TimeEntrySchema.index({ companyId: 1, projectId: 1 });
TimeEntrySchema.index({ companyId: 1, clientId: 1 });
TimeEntrySchema.index({ companyId: 1, taskId: 1 });
TimeEntrySchema.index({ companyId: 1, status: 1 });
TimeEntrySchema.index({ companyId: 1, date: 1 });

export type TimeEntryDoc = InferSchemaType<typeof TimeEntrySchema> & { companyId: Types.ObjectId };
export const TimeEntry = (models.TimeEntry as Model<TimeEntryDoc>) ?? model<TimeEntryDoc>("TimeEntry", TimeEntrySchema);

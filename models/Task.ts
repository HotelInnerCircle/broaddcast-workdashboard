import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";
import { PRIORITIES, TASK_STATUSES } from "@/types";

const AttachmentSchema = new Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true },
    size: { type: Number, required: true },
    mime: { type: String, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const TaskSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: null },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    priority: { type: String, enum: PRIORITIES, default: "Medium" },
    status: { type: String, enum: TASK_STATUSES, default: "To Do" },
    dueDate: { type: Date, default: null },
    estimatedMinutes: { type: Number, default: null },
    /** Cached from time entries (Phase 3). */
    actualMinutes: { type: Number, default: 0 },
    attachments: { type: [AttachmentSchema], default: [] },
    completedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
TaskSchema.plugin(tenantGuardPlugin);
TaskSchema.index({ companyId: 1, projectId: 1 });
TaskSchema.index({ companyId: 1, clientId: 1 });
TaskSchema.index({ companyId: 1, assignedTo: 1, status: 1 });
TaskSchema.index({ companyId: 1, status: 1 });
TaskSchema.index({ companyId: 1, dueDate: 1 });
TaskSchema.index({ companyId: 1, createdAt: -1 });
TaskSchema.index({ companyId: 1, title: "text", description: "text" });

export type TaskDoc = InferSchemaType<typeof TaskSchema> & { companyId: Types.ObjectId };
export type TaskAttachment = InferSchemaType<typeof AttachmentSchema> & { _id: Types.ObjectId };
export const Task = (models.Task as Model<TaskDoc>) ?? model<TaskDoc>("Task", TaskSchema);

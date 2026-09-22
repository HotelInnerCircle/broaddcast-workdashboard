import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

const AttachmentSchema = new Schema({ key: { type: String, required: true }, name: { type: String, required: true }, size: { type: Number, required: true }, mime: { type: String, required: true } }, { timestamps: { createdAt: true, updatedAt: false } });

const TaskCommentSchema = new Schema(
  {
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, required: true },
    mentions: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    attachments: { type: [AttachmentSchema], default: [] },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
TaskCommentSchema.plugin(tenantGuardPlugin);
TaskCommentSchema.index({ companyId: 1, taskId: 1, createdAt: 1 });

export type TaskCommentDoc = InferSchemaType<typeof TaskCommentSchema> & { companyId: Types.ObjectId };
export const TaskComment = (models.TaskComment as Model<TaskCommentDoc>) ?? model<TaskCommentDoc>("TaskComment", TaskCommentSchema);

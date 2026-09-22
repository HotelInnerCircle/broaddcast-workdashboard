import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";
import { PRIORITIES, PROJECT_STATUSES } from "@/types";

const ProjectSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    name: { type: String, required: true, trim: true, maxlength: 140 },
    description: { type: String, default: null },
    managerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    memberIds: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    startDate: { type: Date, default: null },
    deadline: { type: Date, default: null },
    status: { type: String, enum: PROJECT_STATUSES, default: "Planning" },
    priority: { type: String, enum: PRIORITIES, default: "Medium" },
    budget: { type: Number, default: null },
    estimatedHours: { type: Number, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
ProjectSchema.plugin(tenantGuardPlugin);
ProjectSchema.index({ companyId: 1, clientId: 1 });
ProjectSchema.index({ companyId: 1, status: 1 });
ProjectSchema.index({ companyId: 1, memberIds: 1 });
ProjectSchema.index({ companyId: 1, deadline: 1 });
ProjectSchema.index({ companyId: 1, createdAt: -1 });

export type ProjectDoc = InferSchemaType<typeof ProjectSchema> & { companyId: Types.ObjectId };
export const Project = (models.Project as Model<ProjectDoc>) ?? model<ProjectDoc>("Project", ProjectSchema);

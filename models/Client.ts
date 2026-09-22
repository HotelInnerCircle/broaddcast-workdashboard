import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";
import { CLIENT_STATUSES } from "@/types";

const ClientSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    contactPerson: { type: String, default: null, trim: true },
    email: { type: String, default: null, lowercase: true, trim: true },
    phone: { type: String, default: null, trim: true },
    website: { type: String, default: null, trim: true },
    industry: { type: String, default: null, trim: true },
    status: { type: String, enum: CLIENT_STATUSES, default: "active" },
    notes: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
ClientSchema.plugin(tenantGuardPlugin);
ClientSchema.index({ companyId: 1, status: 1 });
ClientSchema.index({ companyId: 1, createdAt: -1 });
ClientSchema.index({ companyId: 1, name: 1 });

export type ClientDoc = InferSchemaType<typeof ClientSchema> & { companyId: Types.ObjectId };
export const Client = (models.Client as Model<ClientDoc>) ?? model<ClientDoc>("Client", ClientSchema);

import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

/** Membership source of truth is user.teamId (spec section 8); team pages query users. */
const TeamSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: null },
    leadId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Manager overseeing this team (assumption: needed for manager scope; see ASSUMPTIONS.md). */
    managerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
TeamSchema.plugin(tenantGuardPlugin);
TeamSchema.index({ companyId: 1, name: 1 }, { unique: true });
TeamSchema.index({ companyId: 1, managerId: 1 });

export type TeamDoc = InferSchemaType<typeof TeamSchema> & { companyId: Types.ObjectId };
export const Team = (models.Team as Model<TeamDoc>) ?? model<TeamDoc>("Team", TeamSchema);

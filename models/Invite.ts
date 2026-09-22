import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";
import { COMPANY_ROLES, INVITE_STATUSES } from "@/types";

const InviteSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    role: { type: String, enum: COMPANY_ROLES, required: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    managerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: INVITE_STATUSES, default: "pending", index: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    lastSentAt: { type: Date, default: null },
  },
  { timestamps: true },
);
InviteSchema.plugin(tenantGuardPlugin);
InviteSchema.index({ companyId: 1, email: 1, status: 1 });
InviteSchema.index({ companyId: 1, createdAt: -1 });

export type InviteDoc = InferSchemaType<typeof InviteSchema> & { companyId: Types.ObjectId };
export const Invite = (models.Invite as Model<InviteDoc>) ?? model<InviteDoc>("Invite", InviteSchema);

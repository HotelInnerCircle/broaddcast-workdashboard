import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

/** Push device tokens (A65): one row per device per user; FCM/APNs delivery targets these. */
const DeviceTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    token: { type: String, required: true },
    platform: { type: String, enum: ["android", "ios", "web"], required: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
DeviceTokenSchema.plugin(tenantGuardPlugin);
DeviceTokenSchema.index({ token: 1 }, { unique: true });
DeviceTokenSchema.index({ companyId: 1, userId: 1 });

export type DeviceTokenDoc = InferSchemaType<typeof DeviceTokenSchema> & { companyId: Types.ObjectId };
export const DeviceToken = (models.DeviceToken as Model<DeviceTokenDoc>) ?? model<DeviceTokenDoc>("DeviceToken", DeviceTokenSchema);

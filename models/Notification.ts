import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";
import { NOTIFICATION_TYPES } from "@/types";

const NotificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    body: { type: String, default: null },
    link: { type: String, default: null },
    readAt: { type: Date, default: null },
    /** Scheduled reminders (deadline/overdue) are deduplicated per user+subject+day. */
    dedupeKey: { type: String, default: null },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
NotificationSchema.plugin(tenantGuardPlugin);
NotificationSchema.index({ companyId: 1, userId: 1, createdAt: -1 });
NotificationSchema.index({ companyId: 1, userId: 1, readAt: 1 });
NotificationSchema.index({ companyId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } });

export type NotificationDoc = InferSchemaType<typeof NotificationSchema> & { companyId: Types.ObjectId };
export const Notification = (models.Notification as Model<NotificationDoc>) ?? model<NotificationDoc>("Notification", NotificationSchema);

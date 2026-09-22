import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

const AnnouncementSchema = new Schema(
  {
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, maxlength: 5000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
AnnouncementSchema.plugin(tenantGuardPlugin);
AnnouncementSchema.index({ companyId: 1, createdAt: -1 });

export type AnnouncementDoc = InferSchemaType<typeof AnnouncementSchema> & { companyId: Types.ObjectId };
export const Announcement = (models.Announcement as Model<AnnouncementDoc>) ?? model<AnnouncementDoc>("Announcement", AnnouncementSchema);

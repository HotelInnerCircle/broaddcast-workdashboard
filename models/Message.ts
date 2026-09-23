import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

/**
 * One attachment. `width`/`height` are filled for images (A72) so the gallery can reserve the right
 * box before the file loads and the thread never jumps while pictures arrive.
 */
const AttachmentSchema = new Schema({ key: { type: String, required: true }, name: { type: String, required: true }, size: { type: Number, required: true }, mime: { type: String, required: true }, width: { type: Number, default: null }, height: { type: Number, default: null } }, { timestamps: { createdAt: true, updatedAt: false } });

const ReceiptSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: "User", required: true }, at: { type: Date, required: true } }, { _id: false });

const MessageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    body: { type: String, default: "" },
    attachments: { type: [AttachmentSchema], default: [] },
    mentions: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    replyTo: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    /** Ticks (A72): `deliveredTo` is acknowledged by the recipient's browser, `readBy` when they open the chat. */
    deliveredTo: { type: [ReceiptSchema], default: [] },
    readBy: { type: [ReceiptSchema], default: [] },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
MessageSchema.plugin(tenantGuardPlugin);
MessageSchema.index({ companyId: 1, conversationId: 1, createdAt: -1 });
MessageSchema.index({ companyId: 1, body: "text" });

export type MessageDoc = InferSchemaType<typeof MessageSchema> & { companyId: Types.ObjectId };
export type MessageAttachment = InferSchemaType<typeof AttachmentSchema> & { _id: Types.ObjectId };
export const Message = (models.Message as Model<MessageDoc>) ?? model<MessageDoc>("Message", MessageSchema);

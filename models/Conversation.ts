import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";
import { CONVERSATION_TYPES } from "@/types";

/**
 * Chat conversations (spec 12.15): direct messages, automatic team and project channels, and
 * `channel` - a named channel a Team Lead creates and manages by hand (A72). A channel carries its
 * own `name`, `description` and explicit `participantIds`; only its members can see it.
 */
const ConversationSchema = new Schema(
  {
    type: { type: String, enum: CONVERSATION_TYPES, required: true },
    participantIds: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    /** Sorted participant ids joined with ":" - makes a DM unique per pair. */
    dmKey: { type: String, default: null },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", default: null },
    /** Channels only (A72). */
    name: { type: String, default: null, trim: true, maxlength: 60 },
    description: { type: String, default: null, trim: true, maxlength: 280 },
    archivedAt: { type: Date, default: null },
    lastMessageAt: { type: Date, default: null },
    lastMessagePreview: { type: String, default: null },
    lastMessageSenderId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Per-user read cursor; unread = messages after `at` not sent by the user. */
    reads: { type: [new Schema({ userId: { type: Schema.Types.ObjectId, ref: "User", required: true }, at: { type: Date, required: true } }, { _id: false })], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
ConversationSchema.plugin(tenantGuardPlugin);
ConversationSchema.index({ companyId: 1, dmKey: 1 }, { unique: true, partialFilterExpression: { dmKey: { $type: "string" } } });
ConversationSchema.index({ companyId: 1, teamId: 1 }, { unique: true, partialFilterExpression: { teamId: { $type: "objectId" } } });
ConversationSchema.index({ companyId: 1, projectId: 1 }, { unique: true, partialFilterExpression: { projectId: { $type: "objectId" } } });
ConversationSchema.index({ companyId: 1, participantIds: 1, lastMessageAt: -1 });

export type ConversationDoc = InferSchemaType<typeof ConversationSchema> & { companyId: Types.ObjectId };
export const Conversation = (models.Conversation as Model<ConversationDoc>) ?? model<ConversationDoc>("Conversation", ConversationSchema);

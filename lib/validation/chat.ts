import { z } from "zod";
import { objectId } from "./common";

export const sendMessageSchema = z.object({
  conversationId: objectId,
  body: z.string().max(4000).default(""),
  mentions: z.array(objectId).max(20).optional(),
  replyTo: objectId.nullable().optional(),
});
/** Channels a Team Lead creates and manages (A72). `members` is the full list; the owner is added server-side. */
export const channelSchema = z.object({
  name: z.string().trim().min(2, "Name the channel").max(60),
  description: z.string().trim().max(280).nullish(),
  members: z.array(objectId).max(500).default([]),
});
/**
 * Spelled out rather than `channelSchema.partial()`: partial() keeps `members`' `.default([])`, so a
 * PATCH that only renamed a channel arrived with `members: []` and emptied it.
 */
export const channelPatchSchema = z.object({
  name: z.string().trim().min(2, "Name the channel").max(60).optional(),
  description: z.string().trim().max(280).nullish(),
  members: z.array(objectId).max(500).optional(),
  archived: z.boolean().optional(),
});
export const channelMembersSchema = z.object({ add: z.array(objectId).max(500).optional(), remove: z.array(objectId).max(500).optional() });
/** Delivery receipts the recipient's browser sends back for messages it has just received (A72). */
export const deliveredSchema = z.object({ messageIds: z.array(objectId).min(1).max(200) });

export const editMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export const openConversationSchema = z.object({ userId: objectId });
export const messagesQuerySchema = z.object({ before: objectId.optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
export const commentSchema = z.object({ body: z.string().trim().min(1, "Write a comment").max(4000), mentions: z.array(objectId).max(20).optional() });
export const announcementSchema = z.object({ title: z.string().trim().min(2).max(160), body: z.string().trim().min(1).max(5000) });
export const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(100) });
export const notificationReadSchema = z.object({ ids: z.union([z.array(objectId).min(1).max(200), z.literal("all")]) });

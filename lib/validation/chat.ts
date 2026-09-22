import { z } from "zod";
import { objectId } from "./common";

export const sendMessageSchema = z.object({
  conversationId: objectId,
  body: z.string().max(4000).default(""),
  mentions: z.array(objectId).max(20).optional(),
  replyTo: objectId.nullable().optional(),
});
export const editMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
export const openConversationSchema = z.object({ userId: objectId });
export const messagesQuerySchema = z.object({ before: objectId.optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
export const commentSchema = z.object({ body: z.string().trim().min(1, "Write a comment").max(4000), mentions: z.array(objectId).max(20).optional() });
export const announcementSchema = z.object({ title: z.string().trim().min(2).max(160), body: z.string().trim().min(1).max(5000) });
export const searchQuerySchema = z.object({ q: z.string().trim().min(1).max(100) });
export const notificationReadSchema = z.object({ ids: z.union([z.array(objectId).min(1).max(200), z.literal("all")]) });

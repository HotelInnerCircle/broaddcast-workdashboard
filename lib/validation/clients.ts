import { z } from "zod";
import { CLIENT_STATUSES } from "@/types";

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

export const createClientSchema = z.object({
  name: z.string().trim().min(2, "Client name is too short").max(120),
  contactPerson: optionalText(120),
  email: z.string().trim().email("Enter a valid email").max(254).nullable().optional().or(z.literal("")).transform((v) => (v ? v.toLowerCase() : null)),
  phone: optionalText(30),
  website: optionalText(200),
  industry: optionalText(80),
  status: z.enum(CLIENT_STATUSES).default("active"),
  services: z.array(z.string().trim().max(60)).max(100).optional(),
  notes: optionalText(5000),
});
export const updateClientSchema = z.object({
  name: z.string().trim().min(2, "Client name is too short").max(120).optional(),
  contactPerson: z.string().trim().max(120).nullable().optional(),
  email: z.string().trim().email("Enter a valid email").max(254).nullable().optional().or(z.literal("")).transform((v) => (v === undefined ? undefined : v ? v.toLowerCase() : null)),
  phone: z.string().trim().max(30).nullable().optional(),
  website: z.string().trim().max(200).nullable().optional(),
  industry: z.string().trim().max(80).nullable().optional(),
  status: z.enum(CLIENT_STATUSES).optional(),
  services: z.array(z.string().trim().max(60)).max(100).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  archived: z.boolean().optional(),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const listClientsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CLIENT_STATUSES).optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

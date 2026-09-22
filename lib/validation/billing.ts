import { z } from "zod";
import { objectId } from "./common";

export const checkoutSchema = z.object({ planId: objectId, cycle: z.enum(["monthly", "yearly"]).default("monthly") });
export const confirmSchema = z.object({ orderId: z.string().min(1), paymentId: z.string().min(1), signature: z.string().min(1), planId: objectId, cycle: z.enum(["monthly", "yearly"]).default("monthly") });
export const updatePlanSchema = z.object({
  limits: z.object({ users: z.number().int().min(-1), projects: z.number().int().min(-1), clients: z.number().int().min(-1), storageMB: z.number().int().min(-1) }).partial().optional(),
  price: z.number().min(0).optional(),
  features: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  isDefault: z.boolean().optional(),
});
export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().trim().max(60).optional(), entity: z.string().trim().max(40).optional(), actorId: objectId.optional(), companyId: objectId.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), crossTenant: z.enum(["true", "false"]).optional(),
});

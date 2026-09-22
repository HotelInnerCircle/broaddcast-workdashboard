import { Types } from "mongoose";
import { Company } from "@/models/Company";
import { Plan } from "@/models/Plan";
import { Subscription } from "@/models/Subscription";
import { User } from "@/models/User";
import { Errors, ApiError } from "@/lib/api/errors";
import { audit } from "@/lib/audit";
import { billingProvider } from "@/lib/billing";
import { planUsage } from "@/lib/limits";
import { env } from "@/lib/env";
import type { CompanyContext } from "@/lib/auth/context";
import type { SessionContext } from "@/types";

const PERIOD_DAYS = { monthly: 30, yearly: 365 } as const;
const price = (p: { price: number }, cycle: "monthly" | "yearly") => (cycle === "yearly" ? Math.round(p.price * 10) : p.price); // yearly = 10 months

export function serializePlan(p: Record<string, unknown>) {
  return { id: String(p._id), name: p.name as string, limits: p.limits as { users: number; projects: number; clients: number; storageMB: number }, features: (p.features as string[]) ?? [], price: p.price as number, yearlyPrice: price({ price: p.price as number }, "yearly"), currency: (p.currency as string) ?? "INR", isDefault: Boolean(p.isDefault) };
}

export async function listPlans() {
  const plans = await Plan.find().sort({ price: 1 }).lean();
  return plans.map((p) => serializePlan(p as Record<string, unknown>));
}

/** Current plan, usage vs limits, subscription record and payment history (spec 12.6 / 12.23). */
export async function getSubscription(ctx: { companyId: string }) {
  const [company, usage, sub] = await Promise.all([Company.findById(ctx.companyId).select("planId name").lean(), planUsage(ctx.companyId), Subscription.findOne({ companyId: new Types.ObjectId(ctx.companyId) }).lean()]);
  const plan = company?.planId ? await Plan.findById(company.planId).lean() : null;
  return {
    plan: plan ? serializePlan(plan as Record<string, unknown>) : null,
    usage: usage.usage,
    subscription: sub ? { id: String(sub._id), status: sub.status, billingCycle: sub.billingCycle, currentPeriodStart: sub.currentPeriodStart, currentPeriodEnd: sub.currentPeriodEnd, provider: sub.provider, payments: sub.payments.map((p) => ({ id: String(p._id), provider: p.provider, orderId: p.orderId, paymentId: p.paymentId, amount: p.amount, currency: p.currency, periodStart: p.periodStart, periodEnd: p.periodEnd, note: p.note, createdAt: p.createdAt })).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) } : null,
    billing: { provider: billingProvider().name, enabled: billingProvider().enabled(), supportEmail: (await import("@/config/brand")).brand.supportEmail },
  };
}

/** Sets the plan and (re)writes the subscription in one place. Used by the Super Admin and by payments. */
export async function applyPlan(companyId: Types.ObjectId, planId: Types.ObjectId, opts: { cycle?: "monthly" | "yearly"; provider?: string; payment?: { orderId: string | null; paymentId: string | null; amount: number; currency: string; note?: string | null } | null; status?: "active" | "trialing" | "past_due" | "cancelled" }) {
  const cycle = opts.cycle ?? "monthly";
  const now = new Date();
  const existing = await Subscription.findOne({ companyId });
  // Extend from the current period end when still active; otherwise start today.
  const base = existing && existing.status === "active" && existing.currentPeriodEnd > now && String(existing.planId) === String(planId) ? existing.currentPeriodEnd : now;
  const end = new Date(base.getTime() + PERIOD_DAYS[cycle] * 86_400_000);
  const payment = opts.payment ? { provider: opts.provider ?? "manual", orderId: opts.payment.orderId, paymentId: opts.payment.paymentId, amount: opts.payment.amount, currency: opts.payment.currency, periodStart: base, periodEnd: end, note: opts.payment.note ?? null } : null;
  await Company.updateOne({ _id: companyId }, { $set: { planId } });
  await Subscription.updateOne(
    { companyId },
    { $set: { planId, status: opts.status ?? "active", billingCycle: cycle, currentPeriodStart: base, currentPeriodEnd: end, provider: opts.provider ?? existing?.provider ?? "manual" }, ...(payment ? { $push: { payments: payment } } : {}) },
    { upsert: true },
  );
  return { periodStart: base, periodEnd: end };
}

/** Admin starts an upgrade: creates a provider order carrying company/plan in its notes (spec 3.6). */
export async function startCheckout(ctx: CompanyContext, input: { planId: string; cycle: "monthly" | "yearly" }, ip: string | null) {
  const provider = billingProvider();
  if (!provider.enabled()) throw new ApiError(503, "BILLING_DISABLED", "Online payments are not enabled. Contact support to change your plan.", { supportEmail: (await import("@/config/brand")).brand.supportEmail });
  const plan = await Plan.findById(input.planId).lean();
  if (!plan) throw Errors.notFound("Plan");
  const amount = price(plan, input.cycle);
  if (amount <= 0) {
    await applyPlan(new Types.ObjectId(ctx.companyId), plan._id, { cycle: input.cycle, provider: "manual" });
    await audit({ ctx, companyId: ctx.companyId, entity: "subscription", entityId: ctx.companyId, action: "plan.changed", summary: `${ctx.name} switched to the free ${plan.name} plan`, after: { planId: String(plan._id) }, ip });
    return { free: true as const, planId: String(plan._id) };
  }
  const order = await provider.createOrder({ amount, currency: plan.currency ?? "INR", receipt: `wp_${ctx.companyId.slice(-8)}_${Date.now()}`, notes: { companyId: ctx.companyId, planId: String(plan._id), cycle: input.cycle } });
  await audit({ ctx, companyId: ctx.companyId, entity: "subscription", entityId: ctx.companyId, action: "billing.checkout_started", summary: `${ctx.name} started checkout for ${plan.name} (${input.cycle})`, after: { orderId: order.orderId, amount, planId: String(plan._id) }, ip });
  const me = await User.findById(new Types.ObjectId(ctx.userId)).select("name email").lean();
  return { free: false as const, order, plan: serializePlan(plan as Record<string, unknown>), cycle: input.cycle, prefill: { name: me?.name ?? ctx.name, email: me?.email ?? ctx.email } };
}

/** Client-side success callback: verified by signature, but the webhook remains the source of truth. */
export async function confirmCheckout(ctx: CompanyContext, input: { orderId: string; paymentId: string; signature: string; planId: string; cycle: "monthly" | "yearly" }, ip: string | null) {
  const provider = billingProvider();
  if (!provider.verifyCheckoutSignature(input.orderId, input.paymentId, input.signature)) throw Errors.bad("INVALID_SIGNATURE", "Payment signature could not be verified");
  const plan = await Plan.findById(input.planId).lean();
  if (!plan) throw Errors.notFound("Plan");
  const already = await Subscription.exists({ companyId: new Types.ObjectId(ctx.companyId), "payments.paymentId": input.paymentId });
  if (!already) {
    await applyPlan(new Types.ObjectId(ctx.companyId), plan._id, { cycle: input.cycle, provider: provider.name, payment: { orderId: input.orderId, paymentId: input.paymentId, amount: price(plan, input.cycle), currency: plan.currency ?? "INR", note: "checkout callback" } });
    await audit({ ctx, companyId: ctx.companyId, entity: "subscription", entityId: ctx.companyId, action: "plan.changed", summary: `${ctx.name} upgraded to ${plan.name} via ${provider.name}`, after: { planId: String(plan._id), paymentId: input.paymentId }, ip });
  }
  return getSubscription(ctx);
}

/**
 * Webhook (spec Phase 6): signature-verified, idempotent on paymentId. `payment.captured` /
 * `order.paid` with our companyId/planId notes activates (or extends) the subscription.
 */
export async function handleWebhook(rawBody: string, signature: string | null) {
  const provider = billingProvider();
  if (!provider.webhooksEnabled()) throw new ApiError(503, "BILLING_DISABLED", "Webhooks are not configured", {});
  if (!provider.verifyWebhookSignature(rawBody, signature)) throw Errors.bad("INVALID_SIGNATURE", "Webhook signature could not be verified");
  const evt = provider.parseWebhook(rawBody);
  if (!evt) throw Errors.bad("INVALID_PAYLOAD", "Unrecognised webhook payload");
  if (!["payment.captured", "order.paid"].includes(evt.event)) return { handled: false, event: evt.event };
  const { companyId, planId, cycle } = evt.notes;
  if (!companyId || !planId || !Types.ObjectId.isValid(companyId) || !Types.ObjectId.isValid(planId)) return { handled: false, event: evt.event, reason: "missing notes" };
  const [company, plan] = await Promise.all([Company.findById(companyId).select("name").lean(), Plan.findById(planId).lean()]);
  if (!company || !plan) return { handled: false, event: evt.event, reason: "unknown company or plan" };
  if (evt.paymentId && (await Subscription.exists({ companyId: company._id, "payments.paymentId": evt.paymentId }))) return { handled: true, event: evt.event, duplicate: true };
  const c: "monthly" | "yearly" = cycle === "yearly" ? "yearly" : "monthly";
  const period = await applyPlan(company._id, plan._id, { cycle: c, provider: provider.name, payment: { orderId: evt.orderId, paymentId: evt.paymentId, amount: evt.amount, currency: evt.currency, note: `webhook ${evt.event}` } });
  await audit({ ctx: null, companyId: company._id, entity: "subscription", entityId: company._id, action: "plan.changed", summary: `Payment received (${provider.name}) - "${company.name}" is now on ${plan.name}`, after: { planId: String(plan._id), paymentId: evt.paymentId, orderId: evt.orderId, amount: evt.amount, currency: evt.currency, periodEnd: period.periodEnd } });
  return { handled: true, event: evt.event, planId: String(plan._id), periodEnd: period.periodEnd };
}

/** Super Admin edits plan limits/prices (spec section 15). */
export async function updatePlan(ctx: SessionContext, planId: string, input: { limits?: Partial<{ users: number; projects: number; clients: number; storageMB: number }>; price?: number; features?: string[]; isDefault?: boolean }, ip: string | null) {
  const plan = await Plan.findById(Types.ObjectId.isValid(planId) ? planId : new Types.ObjectId());
  if (!plan) throw Errors.notFound("Plan");
  const before = serializePlan(plan.toObject() as Record<string, unknown>);
  if (input.limits) plan.set("limits", { ...plan.limits, ...input.limits });
  if (input.price !== undefined) plan.price = input.price;
  if (input.features) plan.set("features", input.features);
  if (input.isDefault === true) { await Plan.updateMany({ _id: { $ne: plan._id } }, { $set: { isDefault: false } }); plan.isDefault = true; }
  await plan.save();
  const after = serializePlan(plan.toObject() as Record<string, unknown>);
  await audit({ ctx, companyId: null, entity: "plan", entityId: plan._id, action: "plan.updated", summary: `${ctx.name} updated the ${plan.name} plan`, before, after, crossTenant: true, ip });
  return after;
}

export const billingEnv = () => ({ keyId: env.RAZORPAY_KEY_ID ? "set" : "missing", webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ? "set" : "missing" });

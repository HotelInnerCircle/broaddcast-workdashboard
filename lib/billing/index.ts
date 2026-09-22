import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Payment provider boundary (spec 3.6). Feature code talks to this interface only; Razorpay is
 * the one implementation. With no keys configured the provider reports `enabled: false` and the
 * plan system keeps working with manual assignment by the Super Admin (spec section 15).
 */
export interface CheckoutOrder { provider: "razorpay"; orderId: string; amount: number; currency: string; keyId: string }
export interface WebhookPayment { event: string; orderId: string | null; paymentId: string | null; amount: number; currency: string; notes: Record<string, string> }

export interface BillingProvider {
  readonly name: string;
  enabled(): boolean;
  webhooksEnabled(): boolean;
  createOrder(input: { amount: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<CheckoutOrder>;
  /** Razorpay checkout returns order_id, payment_id and an HMAC signature the client sends back. */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
  verifyWebhookSignature(rawBody: string, signature: string | null): boolean;
  parseWebhook(rawBody: string): WebhookPayment | null;
}

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const razorpay: BillingProvider = {
  name: "razorpay",
  enabled: () => Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
  webhooksEnabled: () => Boolean(env.RAZORPAY_WEBHOOK_SECRET),
  async createOrder(input) {
    const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Math.round(input.amount * 100), currency: input.currency, receipt: input.receipt.slice(0, 40), notes: input.notes }),
    });
    const body = (await res.json()) as { id?: string; amount?: number; currency?: string; error?: { description?: string } };
    if (!res.ok || !body.id) throw new Error(body.error?.description ?? "Razorpay order creation failed");
    return { provider: "razorpay", orderId: body.id, amount: (body.amount ?? 0) / 100, currency: body.currency ?? input.currency, keyId: env.RAZORPAY_KEY_ID };
  },
  verifyCheckoutSignature(orderId, paymentId, signature) {
    if (!env.RAZORPAY_KEY_SECRET) return false;
    const expected = createHmac("sha256", env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
    return safeEqual(expected, signature);
  },
  verifyWebhookSignature(rawBody, signature) {
    if (!env.RAZORPAY_WEBHOOK_SECRET || !signature) return false;
    const expected = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest("hex");
    return safeEqual(expected, signature);
  },
  parseWebhook(rawBody) {
    try {
      const evt = JSON.parse(rawBody) as { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string; notes?: Record<string, string> } }; order?: { entity?: { id?: string; amount?: number; currency?: string; notes?: Record<string, string> } } } };
      const p = evt.payload?.payment?.entity; const o = evt.payload?.order?.entity;
      if (!evt.event || (!p && !o)) return null;
      return { event: evt.event, orderId: p?.order_id ?? o?.id ?? null, paymentId: p?.id ?? null, amount: ((p?.amount ?? o?.amount) ?? 0) / 100, currency: p?.currency ?? o?.currency ?? "INR", notes: p?.notes ?? o?.notes ?? {} };
    } catch { return null; }
  },
};

export function billingProvider(): BillingProvider {
  return razorpay;
}

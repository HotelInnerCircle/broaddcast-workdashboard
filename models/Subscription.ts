import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";

const PaymentSchema = new Schema(
  {
    provider: { type: String, default: "manual" },
    orderId: { type: String, default: null },
    paymentId: { type: String, default: null },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    note: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** One subscription per company (spec section 8). Company.planId stays the source of truth for limits. */
const SubscriptionSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
    planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
    status: { type: String, enum: ["active", "trialing", "past_due", "cancelled"], default: "active" },
    billingCycle: { type: String, enum: ["monthly", "yearly"], default: "monthly" },
    currentPeriodStart: { type: Date, default: () => new Date() },
    currentPeriodEnd: { type: Date, required: true },
    provider: { type: String, default: "manual" },
    payments: { type: [PaymentSchema], default: [] },
  },
  { timestamps: true },
);
SubscriptionSchema.index({ status: 1, currentPeriodEnd: 1 });
SubscriptionSchema.index({ "payments.paymentId": 1 });

export type SubscriptionDoc = InferSchemaType<typeof SubscriptionSchema>;
export type SubscriptionPayment = InferSchemaType<typeof PaymentSchema> & { _id: Types.ObjectId };
export const Subscription = (models.Subscription as Model<SubscriptionDoc>) ?? model<SubscriptionDoc>("Subscription", SubscriptionSchema);

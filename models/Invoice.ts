import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/** Reserved (spec section 8): schema only, no feature built in the MVP. */
const InvoiceSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription", default: null },
    number: { type: String, default: null },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },
    status: { type: String, enum: ["draft", "issued", "paid", "void"], default: "draft" },
    issuedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    lineItems: { type: [new Schema({ description: String, amount: Number }, { _id: false })], default: [] },
  },
  { timestamps: true },
);

export type InvoiceDoc = InferSchemaType<typeof InvoiceSchema>;
export const Invoice = (models.Invoice as Model<InvoiceDoc>) ?? model<InvoiceDoc>("Invoice", InvoiceSchema);

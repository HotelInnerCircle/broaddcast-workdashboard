import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { PLAN_NAMES } from "@/types";

/** Global (not tenant-scoped). Editable by the Super Admin (spec section 15). */
const PlanSchema = new Schema(
  {
    name: { type: String, enum: PLAN_NAMES, required: true, unique: true },
    limits: {
      users: { type: Number, required: true },
      projects: { type: Number, required: true },
      clients: { type: Number, required: true },
      storageMB: { type: Number, required: true },
    },
    features: { type: [String], default: [] },
    price: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },
    billingCycle: { type: String, enum: ["monthly", "yearly"], default: "monthly" },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export type PlanDoc = InferSchemaType<typeof PlanSchema>;
export const Plan = (models.Plan as Model<PlanDoc>) ?? model<PlanDoc>("Plan", PlanSchema);

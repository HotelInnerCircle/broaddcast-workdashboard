import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";
import { LEAVE_TYPES, LEAVE_STATUSES } from "@/types";
import { APPROVAL_STEPS } from "@/services/approvalChain";

const STEP_DECISIONS = ["PENDING", "APPROVED", "REJECTED", "SKIPPED"] as const;

const StepSchema = new Schema(
  {
    step: { type: String, enum: APPROVAL_STEPS, required: true },
    decision: { type: String, enum: STEP_DECISIONS, default: "PENDING" },
    /** Who is expected to decide. Null for the HR step: any HR may act. */
    approverId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    note: { type: String, default: null },
  },
  { _id: false },
);

/**
 * A leave plan (A91): who, what kind, which days, and what the chain said.
 *
 * Dates are company-timezone day keys, not instants - leave is a run of calendar days and must not
 * shift when the server or the reader moves. `days` is the count of *working* days in the range,
 * computed once at submission against the person's shift and the company's holidays, so a request
 * spanning a weekend or Diwali does not quietly eat the balance.
 */
const LeaveRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: LEAVE_TYPES, required: true },
    startDate: { type: String, required: true },
    endDate: { type: String, required: true },
    days: { type: Number, required: true, min: 0 },
    note: { type: String, default: null },
    /** Optional proof - a medical certificate, say. Private storage, signed on read. */
    attachmentKey: { type: String, default: null },

    status: { type: String, enum: LEAVE_STATUSES, required: true, default: "PENDING" },
    /** Index into `approvals` of the step waiting on someone. Null once settled. */
    currentStep: { type: Number, default: null },
    approvals: { type: [StepSchema], default: [] },
    settledAt: { type: Date, default: null },
  },
  { timestamps: true },
);
LeaveRequestSchema.plugin(tenantGuardPlugin);
LeaveRequestSchema.index({ companyId: 1, userId: 1, startDate: -1 });
LeaveRequestSchema.index({ companyId: 1, status: 1 });

export type LeaveRequestDoc = InferSchemaType<typeof LeaveRequestSchema> & { companyId: Types.ObjectId };
export const LeaveRequest = (models.LeaveRequest as Model<LeaveRequestDoc>) ?? model<LeaveRequestDoc>("LeaveRequest", LeaveRequestSchema);

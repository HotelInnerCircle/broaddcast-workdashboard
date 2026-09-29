import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";
import { LEAVE_TYPES } from "@/types";

/**
 * How many days of each kind a person gets in a year (A91), set by HR.
 *
 * Stored per year so changing next year's allowance never rewrites what people were entitled to
 * last year. The monthly figure people ask about is simply this divided by twelve, accrued as the
 * year goes on rather than granted up front.
 */
const LeavePolicySchema = new Schema(
  {
    type: { type: String, enum: LEAVE_TYPES, required: true },
    year: { type: Number, required: true },
    daysPerYear: { type: Number, required: true, min: 0, max: 365 },
    /** Accrue month by month, or hand the whole year over on day one. */
    monthlyAccrual: { type: Boolean, default: true },
    /**
     * Whether days nobody used survive into next year (A124).
     *
     * Earned leave normally does and casual leave normally does not - it is
     * meant to be taken in the year it is given, and a company that let it pile
     * up would owe years of it to anybody who left. Which way round is a
     * decision each company makes, so it is stored rather than assumed.
     */
    carryForward: { type: Boolean, default: false },
    /**
     * The most that may be carried, in days. Zero means no limit.
     *
     * A cap is what stops a balance growing for a decade and turning into a
     * liability nobody planned for: somebody resigning is owed what they hold.
     */
    carryForwardMax: { type: Number, default: 0, min: 0, max: 365 },
  },
  { timestamps: true },
);
LeavePolicySchema.plugin(tenantGuardPlugin);
LeavePolicySchema.index({ companyId: 1, year: 1, type: 1 }, { unique: true });

export type LeavePolicyDoc = InferSchemaType<typeof LeavePolicySchema> & { companyId: Types.ObjectId };
export const LeavePolicy = (models.LeavePolicy as Model<LeavePolicyDoc>) ?? model<LeavePolicyDoc>("LeavePolicy", LeavePolicySchema);

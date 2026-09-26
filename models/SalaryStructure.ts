import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

/**
 * What a person is paid, from a given date (A103).
 *
 * **Effective-dated, and that is the whole point.** A raise in June must not
 * change what May's payslip said: a payslip has to be reproducible years later
 * exactly as it was issued, because somebody will eventually ask. So a raise is
 * a *new* row with a later `effectiveFrom`, never an edit to the old one, and
 * every payroll run asks which structure was in force on the day the period
 * ended.
 *
 * Amounts are whole rupees per month, at full attendance. What somebody actually
 * earns is this prorated by the days they were paid for, which is computed at
 * run time from the attendance ledger rather than stored here.
 */
const SalaryStructureSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** The first day this scale applies from, "YYYY-MM-DD". */
    effectiveFrom: { type: String, required: true },
    basic: { type: Number, required: true, min: 0 },
    hra: { type: Number, default: 0, min: 0 },
    conveyance: { type: Number, default: 0, min: 0 },
    lta: { type: Number, default: 0, min: 0 },
    /** Whatever is left over to make the agreed gross; often called "special allowance". */
    special: { type: Number, default: 0, min: 0 },
    /** Why it changed - "Annual revision", "Promotion". Shown in the history. */
    note: { type: String, default: null, maxlength: 200 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

SalaryStructureSchema.plugin(tenantGuardPlugin);
/** One scale per person per start date; a correction replaces that day's row. */
SalaryStructureSchema.index({ companyId: 1, userId: 1, effectiveFrom: 1 }, { unique: true });

export type SalaryStructureDoc = InferSchemaType<typeof SalaryStructureSchema>;
export const SalaryStructure =
  (models.SalaryStructure as Model<SalaryStructureDoc>) ?? model<SalaryStructureDoc>("SalaryStructure", SalaryStructureSchema);

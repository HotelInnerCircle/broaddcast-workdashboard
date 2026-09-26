import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

/**
 * One person's payslip for one payroll month (A102).
 *
 * The file is stored privately and served through a signed URL, like every other
 * upload here - a payslip carries somebody's salary, and a guessable link to it
 * would be worse than most things this app stores.
 *
 * `period` is the payroll month it belongs to ("2026-09"), and `from`/`to` are
 * the days that month actually covered - written down rather than recomputed,
 * because a company that changes its cycle later must not silently rewrite what
 * an already-issued payslip claimed to cover.
 *
 * Replacing a payslip is deliberate and audited rather than silent: one row per
 * person per month, so there is never a question of which of two files is the
 * real one.
 */
const PayslipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    /** Payroll month, "YYYY-MM". */
    period: { type: String, required: true, index: true },
    /** The days this period covered, as they were when it was issued. */
    from: { type: String, required: true },
    to: { type: String, required: true },
    /** Storage key; the object is private and fetched through a signed URL. */
    fileKey: { type: String, required: true },
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true },
    contentType: { type: String, required: true },
    /** Optional, for showing a figure in the list without opening the file. */
    netPay: { type: Number, default: null },
    /** Where the file came from: computed here, or a PDF somebody uploaded. */
    source: { type: String, enum: ["generated", "uploaded"], default: "uploaded" },
    /**
     * The figures as they were when this payslip was issued (A103), frozen.
     *
     * Stored rather than recomputed on demand, because a payslip must be
     * reproducible exactly as it was issued - a later raise, a corrected
     * attendance record or a change to the PF ceiling must not silently rewrite
     * what somebody was already told they were paid.
     */
    computation: { type: Schema.Types.Mixed, default: null },
    /** What HR typed in: TDS, a late penalty, an advance, arrears. Kept so a regenerate does not lose them. */
    adjustments: { type: Schema.Types.Mixed, default: null },
    note: { type: String, default: null, maxlength: 500 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** When the employee became able to see it. Null means uploaded but withheld. */
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

PayslipSchema.plugin(tenantGuardPlugin);
/** One payslip per person per month, per company. */
PayslipSchema.index({ companyId: 1, userId: 1, period: 1 }, { unique: true });
PayslipSchema.index({ companyId: 1, period: 1 });

export type PayslipDoc = InferSchemaType<typeof PayslipSchema>;
export const Payslip = (models.Payslip as Model<PayslipDoc>) ?? model<PayslipDoc>("Payslip", PayslipSchema);

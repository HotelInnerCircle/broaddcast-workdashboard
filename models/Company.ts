import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { COMPANY_STATUSES, WEEKDAYS } from "@/types";

const CompanySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true },
    logoUrl: { type: String, default: null },
    timezone: { type: String, default: "Asia/Kolkata" },
    currency: { type: String, default: "INR" },
    workingHours: {
      start: { type: String, default: "09:00" },
      end: { type: String, default: "18:00" },
    },
    workingDays: { type: [String], enum: WEEKDAYS, default: ["mon", "tue", "wed", "thu", "fri"] },
    lateThresholdMinutes: { type: Number, default: 15, min: 0, max: 240 },
    defaultTaskStatus: { type: String, default: "To Do" },

    /*
     * Employee codes (A95). The next number is held here and handed out with an atomic $inc, so
     * two people added at the same moment cannot receive the same code.
     */
    employeeCodePrefix: { type: String, default: "EMP", maxlength: 8 },
    employeeCodePadding: { type: Number, default: 3, min: 1, max: 8 },
    employeeCodeNext: { type: Number, default: 1, min: 1 },
    /**
     * The day of the month a payroll cycle opens (A102). 1 is a plain calendar
     * month; 26 means the 26th to the 25th, which is common so that attendance
     * closes with a few days in hand before payday. Everything that has to agree
     * about which month a day belongs to - the ledger, loss of pay, payslips -
     * derives from this one number.
     */
    payrollStartDay: { type: Number, default: 1, min: 1, max: 31 },
    /** Job designations the admin maintains (A57), e.g. "Web Developer"; picked when adding/editing people. */
    designations: { type: [String], default: [] },
    /** Services the company sells (A69), e.g. "Meta Ads"; ticked per client. */
    services: { type: [String], default: [] },
    /** Menu items hidden per role (A71), keyed by role, values are nav hrefs. Empty = everything visible. */
    hiddenNav: {
      COMPANY_ADMIN: { type: [String], default: [] },
      HR: { type: [String], default: [] },
      MANAGER: { type: [String], default: [] },
      TEAM_LEAD: { type: [String], default: [] },
      EMPLOYEE: { type: [String], default: [] },
    },
    status: { type: String, enum: COMPANY_STATUSES, default: "active", index: true },
    planId: { type: Schema.Types.ObjectId, ref: "Plan", default: null },
    setupCompleted: { type: Boolean, default: false },
    suspendedAt: { type: Date, default: null },
    suspendReason: { type: String, default: null },
  },
  { timestamps: true },
);

export type CompanyDoc = InferSchemaType<typeof CompanySchema>;
export const Company = (models.Company as Model<CompanyDoc>) ?? model<CompanyDoc>("Company", CompanySchema);

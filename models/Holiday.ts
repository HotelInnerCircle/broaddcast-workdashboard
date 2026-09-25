import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

/**
 * A day the company does not work (A90). Stored as a company-timezone day key rather than an
 * instant, because a holiday is a date on a calendar, not a moment - it must not shift when the
 * server, the reader or the clocks move.
 *
 * A holiday stops the day counting as a working day, so nobody is marked absent for it.
 */
const HolidaySchema = new Schema(
  {
    date: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
HolidaySchema.plugin(tenantGuardPlugin);
HolidaySchema.index({ companyId: 1, date: 1 }, { unique: true });

export type HolidayDoc = InferSchemaType<typeof HolidaySchema> & { companyId: Types.ObjectId };
export const Holiday = (models.Holiday as Model<HolidayDoc>) ?? model<HolidayDoc>("Holiday", HolidaySchema);

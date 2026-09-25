import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

/**
 * A place attendance may be swiped from (A83). HR draws a circle - a point and a radius - and a
 * swipe taken inside it is approved on the spot; one taken outside goes to the approval chain.
 *
 * A circle rather than a polygon on purpose: it is one number a person can reason about ("200 m
 * around the office"), it needs no map editor to define, and the distance test is a single
 * calculation with no geometry library.
 */
const WorkSiteSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, default: null },
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    /** Phone GPS is good to ~5-20 m outdoors but far worse indoors, so this is rarely below 100. */
    radiusMeters: { type: Number, required: true, min: 25, max: 20000, default: 150 },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
WorkSiteSchema.plugin(tenantGuardPlugin);
WorkSiteSchema.index({ companyId: 1, active: 1 });
WorkSiteSchema.index({ companyId: 1, name: 1 }, { unique: true });

export type WorkSiteDoc = InferSchemaType<typeof WorkSiteSchema> & { companyId: Types.ObjectId };
export const WorkSite = (models.WorkSite as Model<WorkSiteDoc>) ?? model<WorkSiteDoc>("WorkSite", WorkSiteSchema);

import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

/**
 * A tablet on a wall that takes attendance (A126).
 *
 * Every other session in this app belongs to a person. This one belongs to a
 * device: nobody is signed in at a door, and the whole point is that a person
 * walks up having done nothing beforehand. So the device itself is the thing
 * that is trusted, and trusting a device is a narrower promise than trusting
 * somebody - it may identify a face and record a swipe at its own site, and it
 * may do nothing else at all.
 */
const DoorDeviceSchema = new Schema(
  {
    /** What somebody would call it: "Front gate", "Workshop door". */
    name: { type: String, required: true, trim: true, maxlength: 60 },
    /**
     * Where it is bolted.
     *
     * A fixed device has no business reading GPS - it cannot move, and asking
     * a wall-mounted tablet where it is invites the one answer that would be
     * wrong. Its site is a fact somebody set when they hung it up.
     */
    siteId: { type: Schema.Types.ObjectId, ref: "WorkSite", required: true },
    /**
     * The token, hashed, exactly as sessions and invites are.
     *
     * Shown once when the device is registered and never again. A token that
     * leaks lets somebody post attendance for anybody in the company, so it is
     * stored the way a password is: we keep what proves it, not what is it.
     */
    tokenHash: { type: String, required: true, index: true },
    active: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: null },
    /** So a device nobody recognises can be traced to whoever set it up. */
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
DoorDeviceSchema.plugin(tenantGuardPlugin);
DoorDeviceSchema.index({ companyId: 1, active: 1 });

export type DoorDeviceDoc = InferSchemaType<typeof DoorDeviceSchema> & { companyId: Types.ObjectId };
export const DoorDevice = (models.DoorDevice as Model<DoorDeviceDoc>) ?? model<DoorDeviceDoc>("DoorDevice", DoorDeviceSchema);

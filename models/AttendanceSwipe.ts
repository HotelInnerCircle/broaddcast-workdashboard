import { Schema, Types, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantGuardPlugin } from "@/lib/db/tenant-plugin";

export const SWIPE_TYPES = ["ON_DUTY", "OFF_DUTY"] as const;
export const SWIPE_STATUSES = ["APPROVED", "PENDING", "REJECTED"] as const;
export const APPROVAL_STEPS = ["TEAM_LEAD", "MANAGER", "HR"] as const;
export const STEP_DECISIONS = ["PENDING", "APPROVED", "REJECTED", "SKIPPED"] as const;

/**
 * One swipe: a photo, a place and a moment (A83).
 *
 * Kept separate from `Attendance` deliberately - attendance stays one row per person per day and
 * every report built on it is untouched, while this is an append-only log of individual swipes.
 *
 * `at` is always the server's clock and `lat`/`lng` are what the device reported. The photo is
 * stamped server-side from these same values, so the picture and the record can never disagree.
 */
const StepSchema = new Schema(
  {
    step: { type: String, enum: APPROVAL_STEPS, required: true },
    decision: { type: String, enum: STEP_DECISIONS, default: "PENDING" },
    /** Who is expected to decide. Null for the HR step: any HR in the company may act. */
    approverId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedAt: { type: Date, default: null },
    note: { type: String, default: null },
  },
  { _id: false },
);

const AttendanceSwipeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    /** Company-timezone day, so a swipe lines up with the attendance row for the same date. */
    date: { type: String, required: true },
    type: { type: String, enum: SWIPE_TYPES, required: true },
    at: { type: Date, required: true },

    /** Storage key. Objects are private, so a signed URL is minted per read, as chat does. */
    photoKey: { type: String, required: true },

    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    /** What the device claimed its fix was worth, in metres. Recorded, never trusted. */
    accuracyMeters: { type: Number, default: null },

    siteId: { type: Schema.Types.ObjectId, ref: "WorkSite", default: null },
    siteName: { type: String, default: null },
    /** Distance to the nearest site. Null only when the company has no sites at all. */
    distanceMeters: { type: Number, default: null },
    withinGeofence: { type: Boolean, required: true },
    /**
     * What the face check made of it (A108).
     *
     * "unverified" means it was not checked - nobody enrolled, the company has
     * it switched off, or no face was found in the picture. That is deliberately
     * not the same as "mismatch", which means it was checked and it was not them.
     */
    faceVerdict: { type: String, enum: ["matched", "mismatch", "unverified"], default: "unverified" },
    /** How far from the enrolled face, so a decision can be explained months later. */
    faceDistance: { type: Number, default: null },
    /** How many tries it took, when somebody had to retake. */
    faceAttempts: { type: Number, default: 0 },
    /**
     * Where this swipe came from (A126).
     *
     * A phone swipe is made by somebody signed in, standing where they say they
     * are. A door swipe is made by a tablet that cannot move and did not know
     * who was there until it matched the face. They are not the same evidence
     * and a reviewer should not have to guess which one they are looking at.
     */
    source: { type: String, enum: ["PHONE", "DOOR_DEVICE"], default: "PHONE" },
    deviceId: { type: Schema.Types.ObjectId, ref: "DoorDevice", default: null },
    /**
     * Whether the device saw the face blink.
     *
     * Recorded rather than enforced: somebody the camera cannot see blink - poor
     * light, thick glasses, a person who simply did not - must not be locked out
     * of their own attendance. But a run of swipes with no blink is exactly what
     * holding a photograph up to a door looks like, and that has to be findable.
     */
    liveness: { type: String, enum: ["none", "blink"], default: "none" },

    status: { type: String, enum: SWIPE_STATUSES, required: true },
    /** Index into `approvals` of the step waiting on someone. Null once settled. */
    currentStep: { type: Number, default: null },
    approvals: { type: [StepSchema], default: [] },

    note: { type: String, default: null },
  },
  { timestamps: true },
);
AttendanceSwipeSchema.plugin(tenantGuardPlugin);
AttendanceSwipeSchema.index({ companyId: 1, userId: 1, at: -1 });
AttendanceSwipeSchema.index({ companyId: 1, date: 1 });
AttendanceSwipeSchema.index({ companyId: 1, status: 1, currentStep: 1 });

export type AttendanceSwipeDoc = InferSchemaType<typeof AttendanceSwipeSchema> & { companyId: Types.ObjectId };
export const AttendanceSwipe =
  (models.AttendanceSwipe as Model<AttendanceSwipeDoc>) ?? model<AttendanceSwipeDoc>("AttendanceSwipe", AttendanceSwipeSchema);

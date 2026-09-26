import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * Database sessions (spec 3.2). The cookie carries only the opaque `token`;
 * deleting a row invalidates that session immediately. companyId is denormalized
 * so a company suspension can delete every session in one query.
 */
const SessionSchema = new Schema(
  {
    token: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: () => new Date() },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
    /**
     * Which kind of thing this is (A101). Only one `mobile` session per person is
     * live at a time: signing in on a phone ends the previous phone's session,
     * while desktops and browser tabs are left alone.
     */
    deviceKind: { type: String, enum: ["mobile", "desktop"], default: "desktop", index: true },
    /** Something the person would recognise, e.g. "WorkPulse app on Android". */
    deviceLabel: { type: String, default: null },
    /**
     * Set instead of deleting the row when a session is ended by something other
     * than its own sign-out. The row is kept so the device it belonged to can be
     * told *why* it was signed out rather than being bounced to a login screen
     * with no explanation - which reads as the app being broken.
     */
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { timestamps: true },
);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
/** Finding the live session for a person on a given kind of device. */
SessionSchema.index({ userId: 1, deviceKind: 1, revokedAt: 1 });

export type SessionDoc = InferSchemaType<typeof SessionSchema>;
export const Session = (models.Session as Model<SessionDoc>) ?? model<SessionDoc>("Session", SessionSchema);

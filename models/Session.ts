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
  },
  { timestamps: true },
);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionDoc = InferSchemaType<typeof SessionSchema>;
export const Session = (models.Session as Model<SessionDoc>) ?? model<SessionDoc>("Session", SessionSchema);

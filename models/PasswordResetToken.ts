import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/** Single-use, 1-hour tokens (spec 6.4). Only the sha256 hash is stored. */
const PasswordResetTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export type PasswordResetTokenDoc = InferSchemaType<typeof PasswordResetTokenSchema>;
export const PasswordResetToken =
  (models.PasswordResetToken as Model<PasswordResetTokenDoc>) ??
  model<PasswordResetTokenDoc>("PasswordResetToken", PasswordResetTokenSchema);

import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { ROLES, USER_STATUSES } from "@/types";

/**
 * Users are tenant-scoped except SUPER_ADMIN (companyId null). Because SUPER_ADMIN
 * rows exist, this model does not use the strict tenant plugin; instead every
 * company-facing access goes through scoped(User, ctx) which injects companyId.
 * Auth internals (login by email) are the only unscoped readers.
 */
const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, default: null, select: false },
    role: { type: String, enum: ROLES, required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    teamId: { type: Schema.Types.ObjectId, ref: "Team", default: null },
    managerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    avatarUrl: { type: String, default: null },
    phone: { type: String, default: null },
    department: { type: String, default: null },
    /** One of Company.designations (A57); free text is kept if the list changes later. */
    designation: { type: String, default: null },
    joiningDate: { type: Date, default: null },
    status: { type: String, enum: USER_STATUSES, default: "active", index: true },
    lastActiveAt: { type: Date, default: null },
    notificationPrefs: {
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
    },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

UserSchema.index({ companyId: 1, status: 1 });
UserSchema.index({ companyId: 1, teamId: 1 });
UserSchema.index({ companyId: 1, managerId: 1 });
UserSchema.index({ companyId: 1, createdAt: -1 });
// Presence fallback (A74): "who in this company was active recently?" runs every 30s per open tab.
UserSchema.index({ companyId: 1, lastActiveAt: -1 });

export type UserDoc = InferSchemaType<typeof UserSchema>;
export const User = (models.User as Model<UserDoc>) ?? model<UserDoc>("User", UserSchema);

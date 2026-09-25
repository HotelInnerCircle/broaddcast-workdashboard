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
    /** Working pattern (A90). Null means the company defaults in Settings apply. */
    shiftId: { type: Schema.Types.ObjectId, ref: "Shift", default: null },
    managerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    avatarUrl: { type: String, default: null },
    /** Storage key behind avatarUrl (A93), kept so the old object can be removed on replacement. */
    avatarKey: { type: String, default: null },
    phone: { type: String, default: null },
    department: { type: String, default: null },
    /** One of Company.designations (A57); free text is kept if the list changes later. */
    designation: { type: String, default: null },
    /** A95: the code people are known by - EMP001, or whatever HR set. Unique inside a company. */
    employeeCode: { type: String, default: null },
    joiningDate: { type: Date, default: null },

    /* Personal details (A93). All optional: a profile is filled in over time, not at creation. */
    gender: { type: String, enum: ["male", "female", "other", "prefer_not_to_say", null], default: null },
    maritalStatus: { type: String, enum: ["single", "married", "other", "prefer_not_to_say", null], default: null },
    /** A date of birth is a calendar date, so it is stored at midday UTC to survive timezones. */
    dateOfBirth: { type: Date, default: null },
    branch: { type: String, default: null, maxlength: 80 },
    address: { type: String, default: null, maxlength: 400 },
    emergencyContact: {
      name: { type: String, default: null },
      relation: { type: String, default: null },
      phone: { type: String, default: null },
    },
    /**
     * What someone wants changed on a profile they cannot edit themselves. HR sees it, acts on it
     * and clears it - a one-line request rather than a whole ticketing system.
     */
    updateRequest: { type: String, default: null, maxlength: 500 },
    updateRequestAt: { type: Date, default: null },
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

// Unique per company, but only over documents that actually have one: a partial index lets the
// super admin and anyone not yet assigned a code coexist without colliding on null.
UserSchema.index(
  { companyId: 1, employeeCode: 1 },
  { unique: true, partialFilterExpression: { employeeCode: { $type: "string" } } },
);
UserSchema.index({ companyId: 1, status: 1 });
UserSchema.index({ companyId: 1, teamId: 1 });
UserSchema.index({ companyId: 1, managerId: 1 });
UserSchema.index({ companyId: 1, createdAt: -1 });
// Presence fallback (A74): "who in this company was active recently?" runs every 30s per open tab.
UserSchema.index({ companyId: 1, lastActiveAt: -1 });

export type UserDoc = InferSchemaType<typeof UserSchema>;
export const User = (models.User as Model<UserDoc>) ?? model<UserDoc>("User", UserSchema);

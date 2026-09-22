import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * Append-only audit log (spec 7.9). Written only through lib/audit.ts.
 * companyId is null for platform-level events (super admin actions without a tenant).
 */
const AuditLogSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, default: null },
    actorName: { type: String, default: null },
    entity: { type: String, required: true },
    entityId: { type: String, default: null },
    action: { type: String, required: true, index: true },
    summary: { type: String, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    crossTenant: { type: Boolean, default: false },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
AuditLogSchema.index({ companyId: 1, createdAt: -1 });
AuditLogSchema.index({ companyId: 1, entity: 1, entityId: 1 });
// Append-only: block updates and deletes at the model level.
for (const op of ["updateOne", "updateMany", "findOneAndUpdate", "deleteOne", "deleteMany", "findOneAndDelete", "replaceOne"] as const) {
  AuditLogSchema.pre(op as "updateOne", function () {
    throw new Error("AuditLog is append-only");
  });
}

export type AuditLogDoc = InferSchemaType<typeof AuditLogSchema>;
export const AuditLog = (models.AuditLog as Model<AuditLogDoc>) ?? model<AuditLogDoc>("AuditLog", AuditLogSchema);

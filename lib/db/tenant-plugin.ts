import { Schema } from "mongoose";

/**
 * Tenant guard (spec 4.2): every query on a tenant-scoped model must carry `companyId`
 * in its filter, or explicitly opt out with `.setOptions({ skipTenantGuard: true })`
 * (only allowed from auth internals, super-admin paths, and the seed script).
 * Forgetting the tenant filter therefore throws instead of leaking data.
 */
export const TENANT_GUARD_OPT_OUT = "skipTenantGuard";

const QUERY_OPS = [
  "find", "findOne", "findOneAndUpdate", "findOneAndDelete", "findOneAndReplace",
  "countDocuments", "updateOne", "updateMany", "deleteOne", "deleteMany", "replaceOne", "distinct",
] as const;

function hasCompanyId(filter: Record<string, unknown> | undefined): boolean {
  if (!filter) return false;
  if (filter.companyId !== undefined && filter.companyId !== null) return true;
  const and = filter.$and as Record<string, unknown>[] | undefined;
  return Array.isArray(and) && and.some((f) => hasCompanyId(f));
}

type GuardedQuery = {
  getOptions(): Record<string, unknown>;
  getFilter(): Record<string, unknown>;
  model: { modelName: string };
};

type GuardedAggregate = {
  options: Record<string, unknown>;
  pipeline(): Record<string, unknown>[];
  model(): { modelName: string };
};

export function tenantGuardPlugin(schema: Schema) {
  schema.add({ companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true } });

  for (const op of QUERY_OPS) {
    (schema as unknown as { pre: (op: string, fn: (this: GuardedQuery) => void) => void }).pre(op, function (this: GuardedQuery) {
      const opts = this.getOptions();
      if (opts[TENANT_GUARD_OPT_OUT]) return;
      if (!hasCompanyId(this.getFilter())) {
        throw new Error("TenantGuard: " + this.model.modelName + "." + op + " called without companyId filter");
      }
    });
  }

  (schema as unknown as { pre: (op: string, fn: (this: GuardedAggregate) => void) => void }).pre("aggregate", function (this: GuardedAggregate) {
    if (this.options[TENANT_GUARD_OPT_OUT]) return;
    const first = this.pipeline()[0] as { $match?: Record<string, unknown> } | undefined;
    if (!first?.$match || !hasCompanyId(first.$match)) {
      throw new Error("TenantGuard: " + this.model().modelName + ".aggregate must start with a $match on companyId");
    }
  });
}

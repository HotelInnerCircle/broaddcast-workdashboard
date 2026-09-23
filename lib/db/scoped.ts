import { Types, type QueryFilter, type Model, type UpdateQuery, type QueryOptions, type HydratedDocument, type PipelineStage, type MongooseUpdateQueryOptions } from "mongoose";
import { TENANT_GUARD_OPT_OUT } from "./tenant-plugin";

export interface TenantCtx { companyId: string | Types.ObjectId }

const NIL_ID = new Types.ObjectId("000000000000000000000000");

/**
 * Tenant-scoped data access layer (spec 4.2). Route handlers and services use
 * scoped(Model, ctx) for every tenant collection; companyId is injected into
 * every filter and create, and can never be overridden by caller input.
 */
export function scoped<TRaw>(model: Model<TRaw>, ctx: TenantCtx) {
  const companyId = new Types.ObjectId(String(ctx.companyId));
  const withTenant = (filter: QueryFilter<TRaw> = {}): QueryFilter<TRaw> => ({ ...filter, companyId } as QueryFilter<TRaw>);
  type Doc = HydratedDocument<TRaw>;
  /** Invalid ObjectIds map to a never-matching id so callers get a plain 404 path. */
  const idFilter = (id: string) => ({ _id: Types.ObjectId.isValid(id) ? new Types.ObjectId(id) : NIL_ID } as QueryFilter<TRaw>);

  return {
    companyId,
    find: (filter?: QueryFilter<TRaw>, options?: QueryOptions<TRaw>) => model.find(withTenant(filter), null, options),
    findOne: (filter?: QueryFilter<TRaw>, options?: QueryOptions<TRaw>) => model.findOne(withTenant(filter), null, options),
    findById: (id: string, options?: QueryOptions<TRaw>) => model.findOne(withTenant(idFilter(id)), null, options),
    countDocuments: (filter?: QueryFilter<TRaw>) => model.countDocuments(withTenant(filter)),
    exists: (filter: QueryFilter<TRaw>) => model.exists(withTenant(filter)),
    create: (doc: Record<string, unknown>) => model.create({ ...doc, companyId } as unknown as TRaw) as unknown as Promise<Doc>,
    updateOne: (filter: QueryFilter<TRaw>, update: UpdateQuery<TRaw>, options?: MongooseUpdateQueryOptions<TRaw>) =>
      model.updateOne(withTenant(filter), update, options),
    updateMany: (filter: QueryFilter<TRaw>, update: UpdateQuery<TRaw>, options?: MongooseUpdateQueryOptions<TRaw>) =>
      model.updateMany(withTenant(filter), update, options),
    findOneAndUpdate: (filter: QueryFilter<TRaw>, update: UpdateQuery<TRaw>, options?: QueryOptions<TRaw>) =>
      model.findOneAndUpdate(withTenant(filter), update, { returnDocument: "after", ...options }),
    findByIdAndUpdate: (id: string, update: UpdateQuery<TRaw>, options?: QueryOptions<TRaw>) =>
      model.findOneAndUpdate(withTenant(idFilter(id)), update, { returnDocument: "after", ...options }),
    /** Hard deletes are rare (most records archive); these stay tenant-scoped like every other helper. */
    deleteOne: (filter: QueryFilter<TRaw>) => model.deleteOne(withTenant(filter)),
    deleteMany: (filter: QueryFilter<TRaw>) => model.deleteMany(withTenant(filter)),
    aggregate: <R = unknown>(pipeline: PipelineStage[]) => model.aggregate<R>([{ $match: { companyId } }, ...pipeline]),
  };
}

/** Explicit, auditable opt-out for cross-tenant reads (SUPER_ADMIN, auth internals, seed). */
export const unscopedOptions = { [TENANT_GUARD_OPT_OUT]: true } as const;

/**
 * Populate helper: populated ids always come from an already tenant-scoped parent query,
 * so the child lookup opts out of the guard explicitly instead of silently.
 */
export const pop = (path: string, select: string) => ({ path, select, options: { ...unscopedOptions } });

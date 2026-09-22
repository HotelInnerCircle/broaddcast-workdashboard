import { z } from "zod";

/** ?page=1&limit=20 (max 100) and ?sort=-createdAt (spec section 9). */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().regex(/^-?[a-zA-Z_.]+$/).optional(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function toSort(sort: string | undefined, fallback = "-createdAt"): Record<string, 1 | -1> {
  const s = sort ?? fallback;
  return s.startsWith("-") ? { [s.slice(1)]: -1 } : { [s]: 1 };
}

export function skipFor(p: Pagination) {
  return (p.page - 1) * p.limit;
}

export function meta(p: Pagination, total: number) {
  return { page: p.page, limit: p.limit, total, totalPages: Math.max(1, Math.ceil(total / p.limit)) };
}

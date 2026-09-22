import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Errors } from "@/lib/api/errors";
import { can, type Action, type Resource } from "@/lib/permissions";
import { ROLE_HOME, type Role, type SessionContext } from "@/types";

/** Memoized per request: layouts, pages and route handlers all share one session lookup. */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const session = await auth();
  if (!session?.user?.userId) return null;
  const { id: _id, ...ctx } = session.user;
  void _id;
  return ctx;
});

/** For API route handlers: throws 401 in the standard error shape. */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) throw Errors.unauthorized();
  return ctx;
}

export type CompanyContext = SessionContext & { companyId: string };

/** Tenant-bound context (never SUPER_ADMIN). */
export async function requireCompanySession(): Promise<CompanyContext> {
  const ctx = await requireSession();
  if (!ctx.companyId) throw Errors.forbidden("This action requires a company account");
  return ctx as CompanyContext;
}

export async function requirePermission(resource: Resource, action: Action): Promise<CompanyContext> {
  const ctx = await requireCompanySession();
  if (!can(ctx.role, resource, action)) throw Errors.forbidden();
  return ctx;
}

export async function requireRole(...roles: Role[]): Promise<SessionContext> {
  const ctx = await requireSession();
  if (!roles.includes(ctx.role)) throw Errors.forbidden();
  return ctx;
}

/** For server components/layouts: redirects instead of throwing. */
export async function requirePageSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requirePageRole(...roles: Role[]): Promise<SessionContext> {
  const ctx = await requirePageSession();
  if (!roles.includes(ctx.role)) redirect(ROLE_HOME[ctx.role]);
  return ctx;
}

export async function requirePagePermission(resource: Resource, action: Action): Promise<SessionContext> {
  const ctx = await requirePageSession();
  if (!can(ctx.role, resource, action)) redirect(ROLE_HOME[ctx.role]);
  return ctx;
}

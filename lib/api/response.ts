import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { ApiError, Errors } from "./errors";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}

export interface PageMeta { page: number; limit: number; total: number; totalPages: number }
export function paged<T>(data: T[], meta: PageMeta) {
  return NextResponse.json({ data, meta });
}

export function errorResponse(err: unknown) {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    const details: Record<string, string> = {};
    for (const issue of err.issues) details[issue.path.join(".") || "_"] = issue.message;
    const e = Errors.validation(details);
    return NextResponse.json({ error: { code: e.code, message: e.message, details } }, { status: e.status });
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong", details: {} } },
    { status: 500 },
  );
}

/** Parse + validate a JSON body with Zod; malformed JSON becomes a validation error. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw Errors.bad("INVALID_JSON", "Request body must be valid JSON");
  }
  return schema.parse(json);
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const url = new URL(req.url);
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

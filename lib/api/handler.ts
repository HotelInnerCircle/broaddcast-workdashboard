import type { NextRequest } from "next/server";
import { connectDB } from "@/lib/db/connect";
import { errorResponse } from "./response";

type RouteCtx = { params: Promise<Record<string, string>> };
type Handler = (req: NextRequest, ctx: RouteCtx) => Promise<Response>;

/** Wraps a route handler: ensures DB connection and maps thrown errors to the standard error shape. */
export function route(handler: Handler): Handler {
  return async (req, ctx) => {
    try {
      await connectDB();
      return await handler(req, ctx);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : req.headers.get("x-real-ip")) || "unknown";
}

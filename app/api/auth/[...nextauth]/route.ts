import type { NextRequest } from "next/server";
import { handlers } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/api/handler";
import { errorResponse } from "@/lib/api/response";

export const GET = handlers.GET;

/** Auth routes are rate limited per IP (spec 4.8: ~10 req/min). */
export async function POST(req: NextRequest) {
  try {
    rateLimit(`auth:${clientIp(req)}`, 10, 60_000);
  } catch (err) {
    return errorResponse(err);
  }
  return handlers.POST(req);
}

import type { NextRequest } from "next/server";
import { connectDB } from "@/lib/db/connect";
import { ok, errorResponse } from "@/lib/api/response";
import { handleWebhook } from "@/services/billingService";

/** Razorpay webhook: unauthenticated by design, verified by HMAC over the raw body (spec Phase 6). */
export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const raw = await req.text();
    return ok(await handleWebhook(raw, req.headers.get("x-razorpay-signature")));
  } catch (err) {
    return errorResponse(err);
  }
}

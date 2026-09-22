import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { rateLimit } from "@/lib/rate-limit";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { requestPasswordReset } from "@/services/authService";

export const POST = route(async (req) => {
  rateLimit(`forgot:${clientIp(req)}`, 10, 60_000);
  const { email } = await parseBody(req, forgotPasswordSchema);
  await requestPasswordReset(email);
  // Always the same answer: never reveal whether the email exists (spec 6.4).
  return ok({ message: "If an account exists for that email, a reset link has been sent." });
});

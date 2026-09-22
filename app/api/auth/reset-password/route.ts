import { route, clientIp } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { rateLimit } from "@/lib/rate-limit";
import { resetPasswordSchema } from "@/lib/validation/auth";
import { resetPassword } from "@/services/authService";

export const POST = route(async (req) => {
  rateLimit(`reset:${clientIp(req)}`, 10, 60_000);
  const { token, password } = await parseBody(req, resetPasswordSchema);
  await resetPassword(token, password);
  return ok({ message: "Password updated. You can now sign in." });
});

import { route } from "@/lib/api/handler";
import { ok, parseBody } from "@/lib/api/response";
import { requireSession } from "@/lib/auth/context";
import { changePasswordSchema } from "@/lib/validation/auth";
import { changePassword } from "@/services/authService";

export const POST = route(async (req) => {
  const ctx = await requireSession();
  const input = await parseBody(req, changePasswordSchema);
  await changePassword(ctx.userId, input.currentPassword, input.newPassword, ctx.sessionId);
  return ok({ message: "Password changed. Other sessions have been signed out." });
});

import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { requirePermission } from "@/lib/auth/context";
import { enrolmentRegister } from "@/services/faceService";

/** Who has enrolled a face and who has not - what HR needs before switching the check on. */
export const GET = route(async () => {
  const ctx = await requirePermission("employees", "view");
  return ok(await enrolmentRegister(ctx));
});

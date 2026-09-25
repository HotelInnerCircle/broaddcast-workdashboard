import { route } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requireCompanySession } from "@/lib/auth/context";
import { validateUpload, sniffMatches } from "@/lib/storage";
import { setAvatar } from "@/services/profileService";

/** A profile photo. Images only, and the bytes have to be the image they claim to be. */
export const POST = route(async (req) => {
  const ctx = await requireCompanySession();
  const form = await req.formData();
  const file = form.get("photo");
  if (!(file instanceof File)) throw Errors.bad("PHOTO_REQUIRED", "Choose a photo");
  const { mime, ext } = validateUpload(file, { imagesOnly: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!sniffMatches(buffer, mime)) throw Errors.bad("BAD_IMAGE", "That file is not the image it claims to be");
  return ok({ avatarUrl: await setAvatar(ctx, buffer, mime, ext) });
});

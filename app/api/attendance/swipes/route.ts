import { route, clientIp } from "@/lib/api/handler";
import { created, paged, parseQuery } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { requirePermission } from "@/lib/auth/context";
import { checkLimit } from "@/lib/limits";
import { rateLimit } from "@/lib/rate-limit";
import { swipeCreateSchema, swipeQuerySchema } from "@/lib/validation/swipes";
import { createSwipe, listSwipes } from "@/services/swipeService";

/** Swipes the caller may see (A83). Scope follows the usual people rules. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("attendance", "view");
  const q = parseQuery(req, swipeQuerySchema);
  const res = await listSwipes(ctx, q);
  return paged(res.data, { page: res.page, limit: res.limit, total: res.total, totalPages: Math.ceil(res.total / res.limit) });
});

/**
 * A swipe: a photo plus where the device thinks it is. Multipart, because the photo comes straight
 * from the camera. The server supplies the time and decides whether it was inside a site.
 */
export const POST = route(async (req) => {
  const ctx = await requirePermission("attendance", "create");
  // Keyed by person, not by address: everyone on an office wifi shares an address,
  // and the account is the thing being limited. Twenty a minute is far more than
  // going on and off duty needs, and well under what it takes to keep the image
  // pipeline busy on purpose.
  rateLimit(`swipe:${ctx.userId}`, 20, 60_000);
  const form = await req.formData();
  const photo = form.get("photo");
  if (!(photo instanceof File)) throw Errors.bad("PHOTO_REQUIRED", "Take a photo to swipe");
  await checkLimit(ctx.companyId, "storage", { addBytes: photo.size });
  const input = swipeCreateSchema.parse({
    type: form.get("type"),
    lat: form.get("lat"),
    lng: form.get("lng"),
    accuracyMeters: form.get("accuracyMeters") ?? undefined,
    note: form.get("note") ?? undefined,
  });
  return created(await createSwipe(ctx, input, photo, clientIp(req)));
});

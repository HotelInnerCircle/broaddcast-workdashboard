import { route, clientIp } from "@/lib/api/handler";
import { ok } from "@/lib/api/response";
import { Errors } from "@/lib/api/errors";
import { rateLimit } from "@/lib/rate-limit";
import { resolveDevice, identifyAtDoor } from "@/services/doorService";
import { swipeAtDoor } from "@/services/swipeService";

/**
 * Somebody stood in front of a door device (A126).
 *
 * The only thing a door device may do. It sends a face and a photograph; the
 * server works out who that is and records their swipe. Nobody is signed in,
 * so the request is authorised by the device's own token and can act on
 * nothing outside the company and site that token belongs to.
 *
 * The client says whether it saw a blink. That claim is not trusted on its own -
 * a client can say anything - but it is recorded, and a device that starts
 * sending swipes with no blink is visible in the log. Doing the liveness check
 * server-side would mean streaming video to it, which is a worse trade than
 * this for a tablet on an office wall.
 */
export const POST = route(async (req) => {
  // The token travels in the header, never in the body: a body is logged and
  // replayed far more casually than a header is.
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;

  const device = await resolveDevice(token);
  // Deliberately vague: a device that is not trusted learns nothing about why.
  if (!device) throw Errors.unauthorized();

  // Keyed by device: a door with a queue of people is busy, but a device sending
  // hundreds a minute is broken or being played with.
  rateLimit(`kiosk:${device.deviceId}`, 60, 60_000);

  const form = await req.formData();
  const photo = form.get("photo");
  if (!(photo instanceof File)) throw Errors.bad("PHOTO_REQUIRED", "The device sent no photograph");

  let descriptor: unknown;
  try { descriptor = JSON.parse(String(form.get("faceDescriptor") ?? "null")); } catch { descriptor = null; }
  const live = form.get("live") === "true";

  const found = await identifyAtDoor(device, descriptor);
  if (!found.userId || !found.user) {
    /*
     * Not recognised is not an error to shout about: a visitor, a delivery, or
     * somebody standing at an angle. The screen says so and resets, and nothing
     * is recorded - a swipe against nobody is worse than no swipe.
     */
    return ok({ recognised: false, reason: found.reason, distance: found.distance, margin: found.margin });
  }

  const result = await swipeAtDoor(device, found.user.id, photo, { live, distance: found.distance }, clientIp(req));
  return ok({
    recognised: true,
    name: found.user.name,
    employeeCode: found.user.employeeCode,
    ...result,
  });
});

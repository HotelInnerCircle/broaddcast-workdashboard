import { z } from "zod";
import { SWIPE_TYPES } from "@/models/AttendanceSwipe";

/** A place HR marks as somewhere attendance may be swiped from (A83). */
export const workSiteSchema = z.object({
  name: z.string().trim().min(2, "Give the site a name").max(80),
  address: z.string().trim().max(200).nullable().optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /**
   * Phone GPS is good to ~5-20 m outdoors and much worse indoors, so anything under 50 m will flag
   * people who are genuinely at their desk. 25 m is the floor only because a small site with a
   * good fix is legitimate.
   */
  radiusMeters: z.number().int().min(25, "A radius under 25 m will flag people who are actually there").max(20000),
  active: z.boolean().optional(),
});
export type WorkSiteInput = z.infer<typeof workSiteSchema>;

/** Written out by hand rather than `.partial()`: a rename must not silently reset the radius. */
export const workSitePatchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  address: z.string().trim().max(200).nullable().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radiusMeters: z.number().int().min(25).max(20000).optional(),
  active: z.boolean().optional(),
});
export type WorkSitePatchInput = z.infer<typeof workSitePatchSchema>;

/** What the phone sends with the photo. Numbers arrive as strings in multipart form data. */
export const swipeCreateSchema = z.object({
  type: z.enum(SWIPE_TYPES),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracyMeters: z.coerce.number().min(0).max(100000).optional(),
  note: z.string().trim().max(300).optional(),
});

export const swipeDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(300).optional(),
});

export const swipeQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().optional(),
  status: z.enum(["APPROVED", "PENDING", "REJECTED"]).optional(),
  /** Only what is waiting on me right now. */
  mine: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

import { z } from "zod";

/** Registering a tablet on a door (A126). */
export const doorDeviceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** Where it is bolted - a fixed device never reads GPS. */
  siteId: z.string().trim().min(1),
});

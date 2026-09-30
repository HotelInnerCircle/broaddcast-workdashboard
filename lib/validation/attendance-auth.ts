import { z } from "zod";
import { ATTENDANCE_STATUSES } from "@/types";

/** Settling a single day by hand (A130). */
export const settleDaySchema = z.object({
  userId: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day"),
  status: z.enum(ATTENDANCE_STATUSES),
  /**
   * Required, and not a formality. A day changed by hand months later with no
   * note is indistinguishable from a mistake, and it is the entries that move
   * money which get asked about.
   */
  note: z.string().trim().min(3, "Say why - somebody will read this months from now").max(300),
  leaveType: z.string().trim().max(20).nullable().optional(),
});

import { connectDB } from "../db/connect";
import { autoCloseForgotten } from "../../services/attendanceService";
import { sendReminders } from "./reminders";

/**
 * In-process scheduler for the single-node deployment (spec 3.1). Runs the forgotten clock-out
 * auto-close every 5 minutes. Idempotent, so overlapping runs after a restart are harmless.
 */
export function startJobs() {
  const run = async () => {
    try {
      await connectDB();
      const r = await autoCloseForgotten();
      if (r.attendance) console.log(`[jobs] auto-closed ${r.attendance} attendance, ${r.timers} timers, ${r.breaks} breaks`);
    } catch (err) {
      console.error("[jobs] auto-close failed", err);
    }
  };
  const remind = async () => {
    try { await connectDB(); const r = await sendReminders(); if (r.sent) console.log(`[jobs] sent ${r.sent} deadline/overdue reminders`); }
    catch (err) { console.error("[jobs] reminders failed", err); }
  };
  setTimeout(run, 15_000);
  setTimeout(remind, 20_000);
  setInterval(remind, 30 * 60_000).unref();
  return setInterval(run, 5 * 60_000);
}

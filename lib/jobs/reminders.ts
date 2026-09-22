import { Company } from "../../models/Company";
import { Task } from "../../models/Task";
import { unscopedOptions } from "../db/scoped";
import { buildClock } from "../time/company-clock";
import { notify } from "../../services/notificationService";

/**
 * Daily reminders (spec 12.16 DEADLINE / TASK_OVERDUE). Runs every 30 minutes; each notification
 * carries a dedupe key (user + task + day) so a task is reminded about once per day.
 */
export async function sendReminders(now = new Date()) {
  let sent = 0;
  const companies = await Company.find({ status: "active" }).select("timezone workingHours workingDays lateThresholdMinutes").lean();
  for (const c of companies) {
    const clock = buildClock({ timezone: c.timezone, workingHours: c.workingHours ?? { start: "09:00", end: "18:00" }, workingDays: c.workingDays, lateThresholdMinutes: c.lateThresholdMinutes });
    const today = clock.dayOf(now);
    const tomorrow = clock.dayOf(new Date(now.getTime() + 86_400_000));
    const endTomorrow = new Date(clock.at(tomorrow, "00:00").getTime() + 86_400_000);
    const tasks = await Task.find({ companyId: c._id, archivedAt: null, assignedTo: { $ne: null }, status: { $nin: ["Completed", "Cancelled"] }, dueDate: { $lt: endTomorrow } }).setOptions(unscopedOptions).select("title assignedTo createdBy dueDate").lean();
    for (const t of tasks) {
      const dueKey = clock.dayOf(t.dueDate!);
      const link = `/tasks/${t._id}`;
      if (dueKey < today) {
        if (await notify(c._id, { userId: String(t.assignedTo), type: "TASK_OVERDUE", title: `Overdue: "${t.title}"`, body: `Was due ${dueKey}`, link, dedupeKey: `overdue:${t.assignedTo}:${t._id}:${today}` })) sent++;
        if (t.createdBy && String(t.createdBy) !== String(t.assignedTo) && (await notify(c._id, { userId: String(t.createdBy), type: "TASK_OVERDUE", title: `Overdue: "${t.title}"`, body: `Assigned task was due ${dueKey}`, link, dedupeKey: `overdue:${t.createdBy}:${t._id}:${today}` }))) sent++;
      } else if (dueKey === today || dueKey === tomorrow) {
        if (await notify(c._id, { userId: String(t.assignedTo), type: "DEADLINE", title: `${dueKey === today ? "Due today" : "Due tomorrow"}: "${t.title}"`, link, dedupeKey: `deadline:${t.assignedTo}:${t._id}:${today}` })) sent++;
      }
    }
  }
  return { sent };
}

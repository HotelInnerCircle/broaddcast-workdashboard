import { requirePagePermission } from "@/lib/auth/context";
import { CalendarView } from "@/components/calendar/calendar-view";

export const metadata = { title: "Calendar" };

export default async function CalendarPage() {
  await requirePagePermission("tasks", "view");
  return <CalendarView />;
}

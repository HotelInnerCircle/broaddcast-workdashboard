import { requirePagePermission } from "@/lib/auth/context";
import { TimesheetsView } from "@/components/timesheets/timesheets-view";

export const metadata = { title: "Timesheets" };

export default async function TimesheetsPage() {
  await requirePagePermission("timer", "view");
  return <TimesheetsView />;
}

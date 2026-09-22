import { requirePagePermission } from "@/lib/auth/context";
import { DailyReportForm } from "@/components/reports/daily-views";

export const metadata = { title: "Daily work report" };

export default async function DailyReportPage() {
  await requirePagePermission("dailyReports", "create");
  return <DailyReportForm />;
}

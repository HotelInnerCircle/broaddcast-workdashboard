import { requirePagePermission } from "@/lib/auth/context";
import { DailyReportsManagerView } from "@/components/reports/daily-views";
import { DailyReportForm } from "@/components/reports/daily-views";

export const metadata = { title: "Daily reports" };

/** Managers, admins and team leads see everyone in scope; employees see their own form here too. */
export default async function DailyReportsPage() {
  const ctx = await requirePagePermission("dailyReports", "view");
  return ctx.role === "EMPLOYEE" ? <DailyReportForm /> : <DailyReportsManagerView />;
}

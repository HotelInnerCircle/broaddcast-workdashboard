import { requirePagePermission } from "@/lib/auth/context";
import { TaskReportView } from "@/components/reports/report-views";

export const metadata = { title: "Task report" };

export default async function Page() {
  await requirePagePermission("reports", "view");
  return <TaskReportView />;
}

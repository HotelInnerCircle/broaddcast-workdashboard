import { requirePagePermission } from "@/lib/auth/context";
import { AttendanceReportView } from "@/components/reports/report-views";

export const metadata = { title: "Attendance report" };

export default async function Page() {
  await requirePagePermission("reports", "view");
  return <AttendanceReportView />;
}

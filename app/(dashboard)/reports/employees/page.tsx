import { requirePagePermission } from "@/lib/auth/context";
import { EmployeeReportView } from "@/components/reports/report-views";

export const metadata = { title: "Employee report" };

export default async function Page() {
  await requirePagePermission("reports", "view");
  return <EmployeeReportView />;
}

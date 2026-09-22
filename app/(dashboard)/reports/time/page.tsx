import { requirePagePermission } from "@/lib/auth/context";
import { TimeReportView } from "@/components/reports/report-views";

export const metadata = { title: "Time report" };

export default async function Page() {
  await requirePagePermission("reports", "view");
  return <TimeReportView />;
}

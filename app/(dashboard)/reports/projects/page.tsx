import { requirePagePermission } from "@/lib/auth/context";
import { ProjectReportView } from "@/components/reports/report-views";

export const metadata = { title: "Project report" };

export default async function Page() {
  await requirePagePermission("reports", "view");
  return <ProjectReportView />;
}

import { requirePagePermission } from "@/lib/auth/context";
import { ClientReportView } from "@/components/reports/report-views";

export const metadata = { title: "Client report" };

export default async function Page() {
  await requirePagePermission("reports", "view");
  return <ClientReportView />;
}

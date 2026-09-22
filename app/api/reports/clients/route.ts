import { reportRoute } from "@/lib/api/report-route";
import { clientReport, clientReportTable } from "@/services/reportService";

export const GET = reportRoute("clients", clientReport, clientReportTable);

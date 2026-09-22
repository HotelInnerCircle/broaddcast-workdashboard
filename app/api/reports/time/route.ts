import { reportRoute } from "@/lib/api/report-route";
import { timeReport, timeReportTable } from "@/services/reportService";

export const GET = reportRoute("time", timeReport, timeReportTable);

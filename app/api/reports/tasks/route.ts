import { reportRoute } from "@/lib/api/report-route";
import { taskReport, taskReportTable } from "@/services/reportService";

export const GET = reportRoute("tasks", taskReport, taskReportTable);

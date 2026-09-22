import { reportRoute } from "@/lib/api/report-route";
import { projectReport, projectReportTable } from "@/services/reportService";

export const GET = reportRoute("projects", projectReport, projectReportTable);

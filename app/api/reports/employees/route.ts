import { reportRoute } from "@/lib/api/report-route";
import { employeeReport, employeeReportTable } from "@/services/reportService";

export const GET = reportRoute("employees", employeeReport, employeeReportTable);

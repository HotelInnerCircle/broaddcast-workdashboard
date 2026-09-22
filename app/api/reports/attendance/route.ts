import { reportRoute } from "@/lib/api/report-route";
import { attendanceReport, attendanceReportTable } from "@/services/reportService";

export const GET = reportRoute("attendance", attendanceReport, attendanceReportTable);

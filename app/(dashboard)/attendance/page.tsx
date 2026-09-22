import { requirePagePermission } from "@/lib/auth/context";
import { AttendanceView } from "@/components/attendance/attendance-view";

export const metadata = { title: "Attendance" };

export default async function AttendancePage() {
  await requirePagePermission("attendance", "view");
  return <AttendanceView />;
}

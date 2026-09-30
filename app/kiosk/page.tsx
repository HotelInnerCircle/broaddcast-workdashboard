import { KioskScreen } from "@/components/attendance/kiosk-screen";

export const metadata = { title: "Attendance" };

/**
 * The screen on a tablet at a door (A126).
 *
 * Outside the dashboard on purpose: there is no signed-in person here, no
 * navigation, nothing to tap. Somebody walks up, the camera sees them, and the
 * screen tells them what it recorded. The only state it keeps is the device
 * token, which is entered once when the tablet is hung on the wall.
 */
export default function KioskPage() {
  return <KioskScreen />;
}

import { requirePagePermission } from "@/lib/auth/context";
import { TimerPage } from "@/components/timer/timer-page";

export const metadata = { title: "Timer" };

export default async function TimerRoute() {
  // A139: `create`. The admin reads everybody's timesheets but runs no stopwatch,
  // so the screen for running one sends them home.
  await requirePagePermission("timer", "create");
  return <TimerPage />;
}

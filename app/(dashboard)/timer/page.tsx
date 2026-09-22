import { requirePagePermission } from "@/lib/auth/context";
import { TimerPage } from "@/components/timer/timer-page";

export const metadata = { title: "Timer" };

export default async function TimerRoute() {
  await requirePagePermission("timer", "view");
  return <TimerPage />;
}

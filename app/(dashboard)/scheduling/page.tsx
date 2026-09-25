import { requirePagePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { SchedulingView } from "@/components/scheduling/scheduling-view";

export const metadata = { title: "Shifts & holidays" };

/** A90: HR decides the hours people are judged against, and which days nobody works. */
export default async function SchedulingPage() {
  await requirePagePermission("scheduling", "manage");
  return (
    <>
      <PageHeader
        title="Shifts &amp; holidays"
        description="Give people their own timings instead of the company hours, and mark the days nobody works. Lateness and half days are judged against whichever applies."
      />
      <SchedulingView />
    </>
  );
}

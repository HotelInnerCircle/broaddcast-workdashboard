import { requirePagePermission, requirePageOnTheClock } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { SwipeView } from "@/components/attendance/swipe-view";

export const metadata = { title: "Swipe attendance" };

/**
 * A83: the employee's swipe screen. Anyone who may record their own attendance can reach it.
 * A139: which is not the company admin - they oversee attendance rather than clocking themselves.
 */
export default async function SwipePage() {
  requirePageOnTheClock(await requirePagePermission("attendance", "create"));
  return (
    <>
      <PageHeader
        title="Swipe attendance"
        description="Take a photo to swipe on or off duty. The time and where you are get added to the photo automatically."
      />
      <SwipeView />
    </>
  );
}

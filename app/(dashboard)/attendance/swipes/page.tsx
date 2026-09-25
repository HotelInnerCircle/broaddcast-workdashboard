import { requirePagePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { SwipesView } from "@/components/attendance/swipes-view";

export const metadata = { title: "Attendance swipes" };

/**
 * A83: the approval queue. Everyone who can see attendance beyond their own may decide something
 * at some point, so the buttons are shown to them; the server still decides whose turn it is.
 */
export default async function SwipesPage() {
  const ctx = await requirePagePermission("attendance", "view");
  const canDecide = ctx.role !== "EMPLOYEE";
  return (
    <>
      <PageHeader
        title="Attendance swipes"
        description="Swipes taken inside a work site are approved automatically. Anything taken elsewhere waits on the team lead, then the manager, then HR."
      />
      <SwipesView canDecide={canDecide} />
    </>
  );
}

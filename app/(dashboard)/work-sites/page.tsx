import { requirePagePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { WorkSitesView } from "@/components/attendance/work-sites-view";

export const metadata = { title: "Work sites" };

/** A83: HR (and the Company Admin) define where attendance may be swiped from. */
export default async function WorkSitesPage() {
  await requirePagePermission("workSites", "manage");
  return (
    <>
      <PageHeader
        title="Work sites"
        description="The places people may swipe attendance from. A swipe taken inside one is approved straight away; anywhere else goes to the team lead, then the manager, then HR."
      />
      <WorkSitesView />
    </>
  );
}

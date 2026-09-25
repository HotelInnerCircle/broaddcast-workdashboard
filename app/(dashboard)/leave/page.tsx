import { requirePagePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { LeaveView } from "@/components/leave/leave-view";

export const metadata = { title: "Leave plan" };

/** A91: ask for time off, see where it has reached, and what is left. */
export default async function LeavePage() {
  const ctx = await requirePagePermission("attendance", "create");
  return (
    <>
      <PageHeader
        title="Create a Leave Plan"
        description="Ask for time off. It goes to your team lead, then your manager, then HR."
      />
      <LeaveView canDecide={ctx.role !== "EMPLOYEE"} myUserId={ctx.userId} />
    </>
  );
}

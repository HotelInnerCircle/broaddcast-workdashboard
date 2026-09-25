import { requirePagePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { LedgerView } from "@/components/reports/ledger-view";

export const metadata = { title: "Attendance ledger" };

/** A94: one person, one month, day by day - and what each day was worth. */
export default async function LedgerPage() {
  const ctx = await requirePagePermission("attendance", "view");
  return (
    <>
      <PageHeader
        title="Attendance ledger"
        description="Every day of a month, what it counted as, and whether it earns pay."
      />
      <LedgerView canPickPeople={ctx.role !== "EMPLOYEE"} myUserId={ctx.userId} />
    </>
  );
}

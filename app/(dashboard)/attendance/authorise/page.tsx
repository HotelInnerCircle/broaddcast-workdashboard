import { requirePageSession } from "@/lib/auth/context";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { AuthGrid } from "@/components/attendance/auth-grid";

export const metadata = { title: "Authorise attendance" };

/**
 * The month somebody signs off before it becomes pay (A130).
 *
 * Desktop only in practice - a month is thirty-one columns and a phone cannot
 * show them - but the page is not hidden on a phone, because somebody opening
 * the link from a notification should see the screen rather than nothing. It
 * scrolls sideways there, which is awkward but honest.
 */
export default async function AuthorisePage() {
  const ctx = await requirePageSession();
  const canSettle = can(ctx.role, "attendance", "update");
  return (
    <>
      <PageHeader
        title="Authorise attendance"
        description="Everybody's month, day by day. Open a day to see the swipes behind it and settle it."
      />
      <AuthGrid canSettle={canSettle} />
    </>
  );
}

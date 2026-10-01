import { requireCompanySession, requirePageOnTheClock } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { MyPayslips } from "@/components/payroll/my-payslips";

export const metadata = { title: "My payslips" };

/**
 * A102: a person's own payslips. No grant needed - this is only ever yourself.
 * A141: unless you are the company admin, who is not paid as staff here. Payroll
 * for everybody else is a different screen, and still theirs.
 */
export default async function MyPayslipsPage() {
  requirePageOnTheClock(await requireCompanySession());
  return (
    <>
      <PageHeader title="My payslips" description="Every payslip published for you, with the days it covers." />
      <MyPayslips />
    </>
  );
}

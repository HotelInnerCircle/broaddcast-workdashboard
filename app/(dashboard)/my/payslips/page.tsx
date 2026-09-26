import { requireCompanySession } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { MyPayslips } from "@/components/payroll/my-payslips";

export const metadata = { title: "My payslips" };

/** A102: a person's own payslips. No grant needed - this is only ever yourself. */
export default async function MyPayslipsPage() {
  await requireCompanySession();
  return (
    <>
      <PageHeader title="My payslips" description="Every payslip published for you, with the days it covers." />
      <MyPayslips />
    </>
  );
}

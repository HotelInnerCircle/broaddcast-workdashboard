import { requirePagePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { SalaryRegister } from "@/components/payroll/salary-register";

export const metadata = { title: "Salaries" };

/** A103: what everyone is paid, effective-dated so old payslips stay true. */
export default async function SalariesPage() {
  await requirePagePermission("payslips", "view");
  return (
    <>
      <PageHeader
        title="Salaries"
        description="What each person is paid a month. A change applies from a date, so payslips already issued keep their figures."
      />
      <SalaryRegister />
    </>
  );
}

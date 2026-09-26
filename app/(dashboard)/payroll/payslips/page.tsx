import { requirePagePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { PayslipRegister } from "@/components/payroll/payslip-register";

export const metadata = { title: "Payslips" };

/** A102: who has a payslip for this payroll month, and who is still missing one. */
export default async function PayslipsPage() {
  await requirePagePermission("payslips", "view");
  return (
    <>
      <PageHeader
        title="Payslips"
        description="Upload a payslip for each person. The ones still missing are listed too, so nobody is forgotten."
      />
      <PayslipRegister />
    </>
  );
}

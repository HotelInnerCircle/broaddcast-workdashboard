import { requirePageRole } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { listCompanies, platformStats } from "@/services/superAdminService";
import { PageHeader } from "@/components/ui/page-header";
import { CompaniesTable } from "@/components/dashboard/companies-table";
import { NewCompanyButton } from "@/components/super-admin/company-dialogs";

export const metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const ctx = await requirePageRole("SUPER_ADMIN");
  await connectDB();
  const [companies, stats] = await Promise.all([listCompanies(ctx, null), platformStats(ctx, null)]);
  return (
    <>
      <PageHeader title="Companies" description="Create companies, suspend, reactivate, change plans, or delete. Every action here is audited as cross-tenant." actions={<NewCompanyButton plans={stats.plans} />} />
      <CompaniesTable initial={companies} plans={stats.plans} />
    </>
  );
}

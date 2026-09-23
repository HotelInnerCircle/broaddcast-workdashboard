import { requirePageRole, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { getCompany } from "@/services/companyService";
import { PageHeader } from "@/components/ui/page-header";
import { NavVisibility } from "@/components/admin/nav-visibility";

export const metadata = { title: "Menu visibility" };

/** Company Admin controls which sidebar items each role sees (A71). */
export default async function NavigationVisibilityPage() {
  const ctx = (await requirePageRole("COMPANY_ADMIN")) as CompanyContext;
  await connectDB();
  const company = await getCompany(ctx);
  return (
    <>
      <PageHeader
        title="Menu visibility"
        description="Switch sidebar items on or off for each role while you roll features out. Hiding an item only removes it from the menu - it does not change permissions, and a direct link still works."
      />
      <NavVisibility initial={company.hiddenNav} />
    </>
  );
}

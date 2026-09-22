import { requirePageRole, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { getCompany } from "@/services/companyService";
import { CompanySettingsForm } from "@/components/settings/company-settings-form";

export const metadata = { title: "Set up your workspace" };

/** Short, skippable setup wizard shown once after registration (spec 6.1). */
export default async function SetupPage() {
  const ctx = (await requirePageRole("COMPANY_ADMIN")) as CompanyContext;
  await connectDB();
  const company = await getCompany(ctx);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <p className="text-sm font-medium text-primary">Welcome to {company.name}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Let&apos;s set up your workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">Timezone, working hours and logo. Everything here can be changed later in Settings.</p>
      </div>
      <CompanySettingsForm company={company} mode="setup" />
    </div>
  );
}

import { Building2, Users, Activity, CreditCard, TrendingUp, Sparkles } from "lucide-react";
import { requirePageRole } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { platformStats, listCompanies } from "@/services/superAdminService";
import { StatsCard } from "@/components/dashboard/stats-card";
import { PageHeader } from "@/components/ui/page-header";
import { CompaniesTable } from "@/components/dashboard/companies-table";

export const metadata = { title: "Super admin" };

export default async function SuperAdminDashboardPage() {
  const ctx = await requirePageRole("SUPER_ADMIN");
  await connectDB();
  const [stats, companies] = await Promise.all([platformStats(ctx, null), listCompanies(ctx, null)]);

  return (
    <>
      <PageHeader title="Platform overview" description="Companies, plans and system-level analytics. Every cross-tenant read is audited." />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatsCard label="Companies" value={stats.companies} hint={`${stats.activeCompanies} active`} icon={Building2} />
        <StatsCard label="Users" value={stats.users} hint={`${stats.activeUsers} active in 24h`} icon={Users} tone="info" />
        <StatsCard label="Subscriptions" value={stats.subscriptions} hint="companies with a plan" icon={CreditCard} tone="success" />
        <StatsCard label="MRR" value={`INR ${stats.mrr.toLocaleString("en-IN")}`} hint="from assigned plans" icon={TrendingUp} tone="success" />
        <StatsCard label="New companies" value={stats.newCompanies} hint="last 30 days" icon={Sparkles} tone="warning" />
        <StatsCard label="Suspended" value={stats.companies - stats.activeCompanies} hint="companies" icon={Activity} tone="muted" />
      </div>
      <div id="companies" className="mt-6">
        <CompaniesTable initial={companies} plans={stats.plans} />
      </div>
    </>
  );
}

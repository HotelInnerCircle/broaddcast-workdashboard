import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Users, CreditCard, Building2, ShieldAlert } from "lucide-react";
import { requirePageRole } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { ApiError } from "@/lib/api/errors";
import { companyDetail, platformStats } from "@/services/superAdminService";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatsCard } from "@/components/dashboard/stats-card";
import { ActivityList } from "@/components/dashboard/activity-list";
import { CompaniesTable } from "@/components/dashboard/companies-table";
import { UsageBar } from "@/components/settings/subscription-view";
import { formatDate } from "@/lib/utils/dates";

export const metadata = { title: "Company" };

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageRole("SUPER_ADMIN");
  const { id } = await params;
  await connectDB();
  let c: Awaited<ReturnType<typeof companyDetail>>;
  try { c = await companyDetail(ctx, id, null); } catch (e) { if (e instanceof ApiError && e.status === 404) notFound(); throw e; }
  const stats = await platformStats(ctx, null);
  const planLimits = stats.plans.find((p) => p.id === c.planId)?.limits;
  return (
    <>
      <Link href="/super-admin/companies" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All companies</Link>
      <PageHeader title={c.name} description={`${c.slug} - ${c.timezone} - since ${formatDate(c.createdAt)}`} actions={<Badge variant={c.status === "active" ? "success" : "danger"}>{c.status}</Badge>} />
      <p className="mb-4 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning-soft/40 px-3 py-2 text-xs text-warning"><ShieldAlert className="size-4" />Cross-tenant read: this view has been written to the audit log.</p>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatsCard label="Users" value={c.users} icon={Users} />
        <StatsCard label="Plan" value={c.plan?.name ?? "None"} hint={c.plan ? `INR ${c.plan.price} / month` : undefined} icon={CreditCard} tone="info" />
        <StatsCard label="Subscription" value={c.subscription?.status ?? "-"} hint={c.subscription ? `renews ${formatDate(c.subscription.currentPeriodEnd)} (${c.subscription.provider})` : "no record"} tone={c.subscription?.status === "active" ? "success" : "muted"} />
        <StatsCard label="Clients / projects" value={`${c.usage.usage.clients} / ${c.usage.usage.projects}`} icon={Building2} tone="muted" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <CompaniesTable initial={[{ id: c.id, name: c.name, slug: c.slug, status: c.status, createdAt: c.createdAt, users: c.users, plan: c.plan?.name ?? null, planId: c.planId }]} plans={stats.plans} />
          <ActivityList items={c.recentAudit} title="Recent audit events" />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Usage vs plan</CardTitle><CardDescription>{c.plan?.name ?? "No plan"}</CardDescription></CardHeader>
            <CardContent className="space-y-3 pt-0">
              <UsageBar label="Users" used={c.usage.usage.users} limit={planLimits?.users ?? -1} />
              <UsageBar label="Projects" used={c.usage.usage.projects} limit={planLimits?.projects ?? -1} />
              <UsageBar label="Clients" used={c.usage.usage.clients} limit={planLimits?.clients ?? -1} />
              <UsageBar label="Storage" used={c.usage.usage.storageMB} limit={planLimits?.storageMB ?? -1} unit=" MB" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Administrators</CardTitle></CardHeader>
            <CardContent className="pt-0">{c.admins.length === 0 ? <p className="text-sm text-muted-foreground">No admins.</p> : <ul className="space-y-2 text-sm">{c.admins.map((a) => <li key={a.id}><p className="font-medium">{a.name}</p><p className="text-xs text-muted-foreground">{a.email} - {a.status}</p></li>)}</ul>}</CardContent>
          </Card>
          {c.suspendedAt && <Card className="border-danger/40"><CardHeader><CardTitle>Suspended</CardTitle><CardDescription>{formatDate(c.suspendedAt)}{c.suspendReason ? ` - ${c.suspendReason}` : ""}</CardDescription></CardHeader></Card>}
        </div>
      </div>
    </>
  );
}

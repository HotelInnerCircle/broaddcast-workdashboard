import Link from "next/link";
import { Users, UserPlus, UsersRound, Activity, Settings, CreditCard, ScrollText } from "lucide-react";
import { requirePageRole, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { adminDashboardStats } from "@/services/companyService";
import { workKpis } from "@/services/dashboardService";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { Greeting } from "@/components/dashboard/greeting";
import { MobileHome } from "@/components/dashboard/mobile-home";
import { StatsCard } from "@/components/dashboard/stats-card";
import { ActivityList } from "@/components/dashboard/activity-list";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SetupBanner } from "@/components/dashboard/setup-banner";

export const metadata = { title: "Admin dashboard" };

export default async function AdminDashboardPage() {
  const ctx = (await requirePageRole("COMPANY_ADMIN")) as CompanyContext;
  await connectDB();
  const [stats, kpi] = await Promise.all([adminDashboardStats(ctx), workKpis(ctx)]);
  const limit = stats.usage.plan?.limits?.users ?? null;

  return (
    <>
      <MobileHome
        greeting={`Hi, ${ctx.name.split(" ")[0]}`}
        stats={[
          { label: "Headcount", value: String(stats.headcount), hint: `${stats.activeToday} active today` },
          { label: "Overdue", value: String(kpi.tasks.overdue), hint: `${kpi.projects.active} active projects`, tone: kpi.tasks.overdue > 0 ? "danger" : undefined },
        ]}
        items={[
          { id: "employees", href: "/employees", title: "Employees", meta: `${stats.headcount} people${limit ? ` of ${limit} seats` : ""}`, tone: "info" as const },
          { id: "projects", href: "/projects", title: "Projects", meta: `${kpi.projects.active} active, ${kpi.projects.total} total`, tone: "muted" as const },
          { id: "reports", href: "/reports", title: "Reports", meta: "Hours, tasks, attendance", tone: "success" as const },
        ]}
        itemsTitle="Manage"
        itemsHref="/employees"
      />
      <div className="hidden md:block">
      <Greeting name={ctx.name} timezone={ctx.company!.timezone} subtitle={ctx.company!.name} />
      {!ctx.company!.setupCompleted && <SetupBanner />}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatsCard label="Headcount" value={stats.headcount} hint="active accounts" icon={Users} />
        <StatsCard label="Active today" value={stats.activeToday} hint="signed in within 24h" icon={Activity} tone="success" />
        <StatsCard label="Pending invites" value={stats.invited} icon={UserPlus} tone="warning" />
        <StatsCard label="Teams" value={stats.teams} icon={UsersRound} tone="info" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <ActivityList items={stats.recentAudit} title="Recent audit events" description="Every important action leaves a trail." />
          <div className="grid gap-6 md:grid-cols-2">
            <ComingSoon title="Attendance summary" phase={3} description="Present, late, half-day and absent counts for today." />
            <Card>
              <CardHeader><CardTitle>Projects by status</CardTitle><CardDescription>{kpi.projects.total} projects, {kpi.tasks.overdue} overdue tasks</CardDescription></CardHeader>
              <CardContent className="space-y-2 pt-0">
                {["Planning", "Active", "On Hold", "Completed", "Cancelled"].map((s) => (
                  <div key={s} className="flex items-center justify-between text-sm"><ProjectStatusBadge status={s} /><span className="font-medium tabular-nums">{kpi.projects.byStatus[s] ?? 0}</span></div>
                ))}
                <Button asChild variant="link" className="h-auto p-0"><Link href="/projects">View all projects</Link></Button>
              </CardContent>
            </Card>
          </div>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Plan usage</CardTitle>
              <CardDescription>{stats.usage.plan ? `${stats.usage.plan.name} plan` : "No plan assigned"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <UsageBar label="Users" used={stats.usage.usage.users} limit={limit} />
              <UsageBar label="Projects" used={stats.usage.usage.projects} limit={stats.usage.plan?.limits?.projects ?? null} />
              <UsageBar label="Clients" used={stats.usage.usage.clients} limit={stats.usage.plan?.limits?.clients ?? null} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Quick links</CardTitle></CardHeader>
            <CardContent className="grid gap-2 pt-0">
              <Button asChild variant="outline" className="justify-start"><Link href="/employees"><Users />Employees</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/settings"><Settings />Company settings</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/settings?tab=subscription"><CreditCard />Subscription &amp; billing</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/admin/audit"><ScrollText />Audit log</Link></Button>
            </CardContent>
          </Card>
        </div>
      </div>
      </div>
    </>
  );
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="font-medium">{label}</span><span className="text-muted-foreground">{used}{limit ? ` / ${limit}` : ""}</span></div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className={pct >= 90 ? "h-full bg-danger" : pct >= 70 ? "h-full bg-warning" : "h-full bg-primary"} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

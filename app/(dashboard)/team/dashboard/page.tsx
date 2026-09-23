import { Users, Activity, ListChecks, Clock } from "lucide-react";
import { requirePageRole, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { scopeCounts, teamStatusRows, workKpis } from "@/services/dashboardService";
import { listTasks } from "@/services/taskService";
import { TaskTable } from "@/components/tasks/task-table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { scoped } from "@/lib/db/scoped";
import { Team } from "@/models/Team";
import { Greeting } from "@/components/dashboard/greeting";
import { MobileHome, type MobileItem } from "@/components/dashboard/mobile-home";
import { HoursCard } from "@/components/dashboard/hours-card";
import { formatDuration } from "@/lib/utils/dates";
import { StatsCard } from "@/components/dashboard/stats-card";
import { LiveStatus } from "@/components/dashboard/live-status";
import { ComingSoon } from "@/components/dashboard/coming-soon";

export const metadata = { title: "Team dashboard" };

export default async function TeamLeadDashboardPage() {
  const ctx = (await requirePageRole("TEAM_LEAD")) as CompanyContext;
  await connectDB();
  const [counts, rows, kpi, teamTasks, team] = await Promise.all([
    scopeCounts(ctx), teamStatusRows(ctx), workKpis(ctx), listTasks(ctx, { page: 1, limit: 8, sort: "dueDate" }),
    ctx.teamId ? scoped(Team, ctx).findById(ctx.teamId).select("name").lean() : null,
  ]);
  const working = rows.filter((r) => r.presence === "working").length;
  const online = rows.filter((r) => r.presence === "online").length;
  const teamSeconds = rows.reduce((s, r) => s + r.todaySeconds, 0);

  const mobileItems: MobileItem[] = (JSON.parse(JSON.stringify(teamTasks.data)) as { id: string; title: string; overdue?: boolean; status: string; project?: { name?: string } | null; assignee?: { name?: string } | null }[])
    .slice(0, 5).map((t) => ({ id: t.id, href: `/tasks/${t.id}`, title: t.title, meta: [t.project?.name, t.assignee?.name].filter(Boolean).join(" \u00b7 "), tone: t.overdue ? "danger" : t.status === "In Progress" ? "info" : "muted", badge: t.overdue ? "late" : undefined }));

  return (
    <>
      <MobileHome
        greeting={`Hi, ${ctx.name.split(" ")[0]}`}
        stats={[
          { label: "Team working", value: `${working}/${rows.length}`, hint: `${online} online` },
          { label: "Team hours", value: formatDuration(teamSeconds), hint: "today" },
        ]}
        items={mobileItems}
        itemsTitle="Team tasks"
      />
      <div className="hidden md:block">
      <Greeting name={ctx.name} timezone={ctx.company!.timezone} subtitle={team ? `Team ${team.name}` : "No team assigned yet"} />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatsCard label="Team members" value={counts.total} icon={Users} />
        <StatsCard label="Working now" value={working} hint={`${online} more online`} icon={Activity} tone="success" />
        <StatsCard label="Open team tasks" value={kpi.tasks.pending} hint={`${kpi.tasks.overdue} overdue`} icon={ListChecks} tone={kpi.tasks.overdue > 0 ? "danger" : "info"} />
        <StatsCard label="Team hours today" value={formatDuration(teamSeconds)} icon={Clock} tone="info" />
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2"><LiveStatus initial={JSON.parse(JSON.stringify(rows))} title="Team status" /></div>
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Team tasks</CardTitle><CardDescription>Latest tasks across your team.</CardDescription></CardHeader><CardContent className="p-0 pt-0"><TaskTable tasks={JSON.parse(JSON.stringify(teamTasks.data))} showProject={false} /></CardContent></Card>
          <HoursCard rows={rows} title="Team hours today" />
        </div>
      </div>
      </div>
    </>
  );
}

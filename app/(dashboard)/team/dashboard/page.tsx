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
import { MobileHome } from "@/components/dashboard/mobile-home";
import { DayHero } from "@/components/dashboard/day-hero";
import { QuickTiles, type LauncherTile } from "@/components/dashboard/tiles";
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


  // A81: one launcher list for both the phone grid and the desktop row.
  const leadTiles: LauncherTile[] = [
    { href: "/tasks", label: "Tasks", icon: "tasks", tone: "work", badge: kpi.tasks.overdue, hint: `${kpi.tasks.pending} open` },
    { href: "/employees", label: "My team", icon: "people", tone: "work-2", hint: `${working} working, ${online} online` },
    { href: "/projects", label: "Projects", icon: "projects", tone: "work-3", hint: "your team's work" },
    { href: "/timer", label: "Timer", icon: "timer", tone: "time", hint: "track your own time" },
    { href: "/timesheets", label: "Timesheets", icon: "timesheets", tone: "time-2", hint: `${formatDuration(teamSeconds)} today` },
    { href: "/attendance", label: "Attendance", icon: "attendance", tone: "time-3", hint: "who is in today" },
    { href: "/reports/daily", label: "Daily reports", icon: "report", tone: "admin", hint: "what your team did" },
    { href: "/reports", label: "Reports", icon: "reports", tone: "admin-2", hint: "team hours" },
    { href: "/chat", label: "Chat", icon: "chat", tone: "muted", hint: "your team" },
  ];

  return (
    <>
      <MobileHome
        tiles={leadTiles}
        timezone={ctx.company!.timezone}
        alert={kpi.tasks.overdue > 0 ? { href: "/tasks", text: `${kpi.tasks.overdue} team task${kpi.tasks.overdue === 1 ? "" : "s"} overdue`, tone: "danger" } : null}
      />
      <div className="hidden md:block">
      <Greeting name={ctx.name} timezone={ctx.company!.timezone} subtitle={team ? `Team ${team.name}` : "No team assigned yet"} />
      <div className="mb-4 mt-5"><DayHero /></div>
      <QuickTiles tiles={leadTiles} className="mb-6" />
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

import Link from "next/link";
import { Users, UserPlus, UsersRound, Activity, Building2, FolderKanban, ListChecks, Megaphone } from "lucide-react";
import { requirePageRole, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { scopeCounts, teamStatusRows, workKpis } from "@/services/dashboardService";
import { Greeting } from "@/components/dashboard/greeting";
import { MobileHome } from "@/components/dashboard/mobile-home";
import { DayHero } from "@/components/dashboard/day-hero";
import { QuickTiles, type LauncherTile } from "@/components/dashboard/tiles";
import { StatsCard } from "@/components/dashboard/stats-card";
import { LiveStatus } from "@/components/dashboard/live-status";
import { LiveActivity } from "@/components/dashboard/live-activity";
import { ChatWidget } from "@/components/chat/chat-widget";
import { ComingSoon } from "@/components/dashboard/coming-soon";
import { OverdueCard } from "@/components/dashboard/overdue-card";
import { HoursCard } from "@/components/dashboard/hours-card";
import { listTasks } from "@/services/taskService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Manager dashboard" };

export default async function ManagerDashboardPage() {
  const ctx = (await requirePageRole("MANAGER")) as CompanyContext;
  await connectDB();
  const [counts, rows, kpi] = await Promise.all([scopeCounts(ctx), teamStatusRows(ctx), workKpis(ctx)]);
  const working = rows.filter((r) => r.presence === "working").length;
  const onBreak = rows.filter((r) => r.presence === "break").length;
  const online = rows.filter((r) => r.presence === "online").length;
  const overdue = JSON.parse(JSON.stringify((await listTasks(ctx, { overdue: "true", page: 1, limit: 8, sort: "dueDate" })).data));

  // A81: one launcher list for both the phone grid and the desktop row.
  const managerTiles: LauncherTile[] = [
    { href: "/employees", label: "People", icon: "people", tone: "work", hint: `${working} working, ${online} online` },
    { href: "/tasks", label: "Tasks", icon: "tasks", tone: "work-2", badge: kpi.tasks.overdue, hint: `${kpi.tasks.pending} open` },
    { href: "/projects", label: "Projects", icon: "projects", tone: "work-3", hint: `${kpi.projects.active} active` },
    { href: "/clients", label: "Clients", icon: "clients", tone: "time-2", hint: "yours and shared" },
    { href: "/timer", label: "Timer", icon: "timer", tone: "time", hint: "track your own time" },
    { href: "/attendance", label: "Attendance", icon: "attendance", tone: "time-3", hint: "who is in today" },
    { href: "/reports/daily", label: "Daily reports", icon: "report", tone: "admin", hint: "what your people did" },
    { href: "/reports", label: "Reports", icon: "reports", tone: "admin-2", hint: "hours and output" },
    { href: "/chat", label: "Chat", icon: "chat", tone: "muted", hint: "your team" },
  ];

  return (
    <>
      <MobileHome
        tiles={managerTiles}
        timezone={ctx.company!.timezone}
        alert={kpi.tasks.overdue > 0 ? { href: "/tasks", text: `${kpi.tasks.overdue} task${kpi.tasks.overdue === 1 ? "" : "s"} overdue in your scope`, tone: "danger" } : null}
      />
      <div className="hidden md:block">
      <Greeting name={ctx.name} timezone={ctx.company!.timezone} />
      <div className="mb-4 mt-5"><DayHero /></div>
      <QuickTiles tiles={managerTiles} className="mb-6" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <StatsCard label="Total employees" value={counts.total} hint="in your scope" icon={Users} />
        <StatsCard label="Currently working" value={working} hint="timer running" icon={Activity} tone="success" />
        <StatsCard label="On break" value={onBreak} tone="warning" />
        <StatsCard label="Online" value={online} hint="active in last 5 min" tone="info" />
        <StatsCard label="Offline" value={Math.max(0, rows.length - working - onBreak - online)} tone="muted" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <StatsCard label="Total tasks" value={kpi.tasks.total} hint={`${kpi.tasks.pending} pending`} icon={ListChecks} />
        <StatsCard label="Completed" value={kpi.tasks.completed} tone="success" />
        <StatsCard label="Overdue" value={kpi.tasks.overdue} tone={kpi.tasks.overdue > 0 ? "danger" : "muted"} />
        <StatsCard label="Active projects" value={kpi.projects.active} hint={`${kpi.projects.total} total`} icon={FolderKanban} tone="info" />
        <StatsCard label="Active clients" value={kpi.activeClients} icon={Building2} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <LiveStatus initial={JSON.parse(JSON.stringify(rows))} title="Live employee status" />
          <div className="grid gap-6 md:grid-cols-2">
            <HoursCard rows={rows} />
            <OverdueCard tasks={overdue} />
          </div>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Quick actions</CardTitle></CardHeader>
            <CardContent className="grid gap-2 pt-0">
              <Button asChild variant="outline" className="justify-start"><Link href="/employees?invite=1"><UserPlus />Add employee</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/teams"><UsersRound />Manage teams</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/clients"><Building2 />Add client</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/projects?new=1"><FolderKanban />Create project</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/tasks?new=1"><ListChecks />Create / assign task</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/announcements?new=1"><Megaphone />Announcement</Link></Button>
            </CardContent>
          </Card>
          <LiveActivity />
          <ChatWidget />
        </div>
      </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { Clock, ListChecks, CalendarClock, Timer, MessageSquare, FileText, AlertTriangle, CalendarDays } from "lucide-react";
import { requirePageRole, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { scoped } from "@/lib/db/scoped";
import { User } from "@/models/User";
import { Team } from "@/models/Team";
import { myWork } from "@/services/dashboardService";
import { hoursSummary } from "@/services/timesheetService";
import { StopwatchWidget } from "@/components/timer/stopwatch-widget";
import { Greeting } from "@/components/dashboard/greeting";
import { StatsCard } from "@/components/dashboard/stats-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge, TaskStatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatDuration } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import type { TaskRow } from "@/components/tasks/types";

export const metadata = { title: "My dashboard" };

const ORDER = ["In Progress", "Review", "To Do", "Backlog", "Blocked", "On Hold"];

export default async function EmployeeDashboardPage() {
  const ctx = (await requirePageRole("EMPLOYEE")) as CompanyContext;
  await connectDB();
  const [manager, team, work, hours] = await Promise.all([
    ctx.managerId ? scoped(User, ctx).findById(ctx.managerId).select("name email avatarUrl").lean() : null,
    ctx.teamId ? scoped(Team, ctx).findById(ctx.teamId).select("name").lean() : null,
    myWork(ctx),
    hoursSummary(ctx, ctx.userId),
  ]);
  const grouped = JSON.parse(JSON.stringify(work.grouped)) as Record<string, TaskRow[]>;
  const upcoming = JSON.parse(JSON.stringify(work.upcoming)) as TaskRow[];
  const focusCount = Object.values(grouped).reduce((n, l) => n + l.length, 0);

  return (
    <>
      <Greeting name={ctx.name} timezone={ctx.company!.timezone} subtitle={team ? `Team ${team.name}` : undefined} />
      <StopwatchWidget />

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard label="Open tasks" value={work.openCount} icon={ListChecks} />
        <StatsCard label="Overdue" value={work.overdueCount} icon={AlertTriangle} tone={work.overdueCount > 0 ? "danger" : "muted"} />
        <StatsCard label="Today" value={formatDuration(hours.todaySeconds)} hint="tracked" icon={Clock} tone="success" />
        <StatsCard label="This week" value={formatDuration(hours.weekSeconds)} hint={`${formatDuration(hours.monthSeconds)} this month`} icon={Clock} tone="info" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Today&apos;s focus</CardTitle><CardDescription>In progress, in review, due today or overdue.</CardDescription></div>
              <Button asChild variant="outline" size="sm"><Link href="/tasks">All my tasks</Link></Button>
            </CardHeader>
            <CardContent className="space-y-5 pt-0">
              {focusCount === 0 ? <EmptyState icon={ListChecks} title="You're all caught up" description="Nothing is due today. Pick something from your task list." className="py-8" /> : ORDER.filter((s) => grouped[s]?.length).map((s) => (
                <div key={s}>
                  <div className="mb-2 flex items-center gap-2"><TaskStatusBadge status={s} /><span className="text-xs text-muted-foreground">{grouped[s].length}</span></div>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {grouped[s].map((t) => (
                      <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                        <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">{t.title}</Link>
                        <span className="hidden truncate text-xs text-muted-foreground sm:inline">{t.project?.name}</span>
                        <PriorityBadge priority={t.priority} />
                        {t.dueDate && <span className={cn("text-xs", t.overdue ? "font-medium text-danger" : "text-muted-foreground")}>{formatDate(t.dueDate)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Upcoming deadlines</CardTitle><CardDescription>Next 7 days.</CardDescription></CardHeader>
            <CardContent className="pt-0">
              {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">No deadlines in the next week.</p> : (
                <ul className="divide-y divide-border">{upcoming.map((t) => <li key={t.id} className="flex items-center gap-3 py-2 text-sm"><CalendarDays className="size-4 text-muted-foreground" /><Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">{t.title}</Link><span className="text-xs text-muted-foreground">{formatDate(t.dueDate)}</span></li>)}</ul>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Your manager</CardTitle><CardDescription>Who to reach when you are blocked.</CardDescription></CardHeader>
            <CardContent className="pt-0">
              {manager ? (
                <div className="flex items-center gap-3"><Avatar name={manager.name} src={manager.avatarUrl} /><div><p className="text-sm font-medium">{manager.name}</p><p className="text-xs text-muted-foreground">{manager.email}</p></div></div>
              ) : <p className="text-sm text-muted-foreground">No manager assigned yet.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Quick actions</CardTitle></CardHeader>
            <CardContent className="grid gap-2 pt-0">
              <Button asChild variant="outline" className="justify-start"><Link href="/timer"><Timer />Start timer</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/tasks"><ListChecks />View tasks</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/calendar"><CalendarClock />View calendar</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/daily-report"><FileText />Submit daily report</Link></Button>
              <Button asChild variant="outline" className="justify-start"><Link href="/chat"><MessageSquare />Send message</Link></Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

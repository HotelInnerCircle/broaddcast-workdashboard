import Link from "next/link";
import { Types } from "mongoose";
import { CalendarDays, ListChecks } from "lucide-react";
import { requirePageRole, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { scoped } from "@/lib/db/scoped";
import { User } from "@/models/User";
import { Team } from "@/models/Team";
import { DailyReport } from "@/models/DailyReport";
import { myWork } from "@/services/dashboardService";
import { hoursSummary } from "@/services/timesheetService";
import { companyClock } from "@/lib/time/company-clock";
import { Greeting } from "@/components/dashboard/greeting";
import { MobileHome, type MobileAlert } from "@/components/dashboard/mobile-home";
import { DayHero } from "@/components/dashboard/day-hero";
import { QuickTiles, type LauncherTile } from "@/components/dashboard/tiles";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { PriorityBadge } from "@/components/ui/status-badge";
import { formatDate, formatDuration } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import type { TaskRow } from "@/components/tasks/types";

export const metadata = { title: "My dashboard" };

const ORDER = ["In Progress", "Review", "To Do", "Backlog", "Blocked", "On Hold"];

export default async function EmployeeDashboardPage() {
  const ctx = (await requirePageRole("EMPLOYEE")) as CompanyContext;
  await connectDB();
  const today = (await companyClock(ctx.companyId)).dayOf(new Date());
  const [manager, team, work, hours, reportToday] = await Promise.all([
    ctx.managerId ? scoped(User, ctx).findById(ctx.managerId).select("name email avatarUrl").lean() : null,
    ctx.teamId ? scoped(Team, ctx).findById(ctx.teamId).select("name").lean() : null,
    myWork(ctx),
    hoursSummary(ctx, ctx.userId),
    scoped(DailyReport, ctx).exists({ userId: new Types.ObjectId(ctx.userId), date: today }),
  ]);
  const grouped = JSON.parse(JSON.stringify(work.grouped)) as Record<string, TaskRow[]>;
  const upcoming = JSON.parse(JSON.stringify(work.upcoming)) as TaskRow[];
  const focusList = ORDER.flatMap((s) => grouped[s] ?? []);
  const reportDone = Boolean(reportToday);

  /**
   * The launcher (A81). The same list drives the phone grid and the desktop row; `visibleTiles`
   * drops anything this person's role or the company's menu-visibility settings hide, so a tile
   * can never be a back door to a page the sidebar is hiding.
   */
  const tiles: LauncherTile[] = [
    { href: "/tasks", label: "Tasks", icon: "tasks", tone: "work", badge: work.openCount, hint: work.overdueCount > 0 ? `${work.overdueCount} overdue` : `${work.openCount} open` },
    { href: "/timer", label: "Timer", icon: "timer", tone: "time", hint: formatDuration(hours.todaySeconds) + " today" },
    { href: "/timesheets", label: "Timesheets", icon: "timesheets", tone: "time-2", hint: formatDuration(hours.weekSeconds) + " this week" },
    { href: "/attendance", label: "Attendance", icon: "attendance", tone: "time-3", hint: "clock in and out" },
    { href: "/daily-report", label: "Daily report", icon: "report", tone: "admin", badge: reportDone ? undefined : true, hint: reportDone ? "submitted" : "not written" },
    { href: "/chat", label: "Chat", icon: "chat", tone: "work-3", hint: "your team" },
    { href: "/projects", label: "Projects", icon: "projects", tone: "work-2", hint: "what you are on" },
    { href: "/calendar", label: "Calendar", icon: "calendar", tone: "admin-2", hint: "deadlines" },
    { href: "/reports", label: "Reports", icon: "reports", tone: "muted", hint: "your hours" },
  ];

  // One line, and only when something is actually wrong.
  const alert: MobileAlert | null = work.overdueCount > 0
    ? { href: "/tasks", text: `${work.overdueCount} task${work.overdueCount === 1 ? "" : "s"} overdue${reportDone ? "" : " · report not written"}`, tone: "danger" }
    : !reportDone
      ? { href: "/daily-report", text: "Daily report not written yet", tone: "warning" }
      : null;

  return (
    <>
      <MobileHome tiles={tiles} alert={alert} timezone={ctx.company!.timezone} />

      <div className="hidden md:block">
        <Greeting name={ctx.name} timezone={ctx.company!.timezone} subtitle={team ? `Team ${team.name}` : undefined} />

        <div className="mt-5"><DayHero /></div>

        <QuickTiles tiles={tiles} className="mt-4" />

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <div><CardTitle>Up next</CardTitle><CardDescription>In progress, in review, due today or overdue.</CardDescription></div>
                <Button asChild variant="outline" size="sm"><Link href="/tasks">All my tasks</Link></Button>
              </CardHeader>
              <CardContent className="pt-0">
                {focusList.length === 0 ? (
                  <EmptyState icon={ListChecks} title="You're all caught up" description="Nothing is due today. Pick something from your task list." className="py-8" />
                ) : (
                  <ul className="divide-y divide-border">
                    {focusList.slice(0, 6).map((t) => (
                      <li key={t.id} className="flex items-center gap-3 py-3">
                        <span className={cn("size-2.5 shrink-0 rounded-full", t.overdue ? "bg-danger" : t.status === "In Progress" ? "bg-success" : "bg-muted-foreground/50")} />
                        <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium hover:text-primary">{t.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{[t.client?.name, t.project?.name].filter(Boolean).join(" · ")}</span>
                        </Link>
                        <PriorityBadge priority={t.priority} />
                        {t.dueDate && (
                          <span className={cn("shrink-0 text-xs font-medium", t.overdue ? "rounded-full bg-danger-soft px-2.5 py-1 text-danger" : "text-muted-foreground")}>
                            {formatDate(t.dueDate, ctx.company!.timezone)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Upcoming deadlines</CardTitle><CardDescription>Next 7 days.</CardDescription></CardHeader>
              <CardContent className="pt-0">
                {upcoming.length === 0 ? <p className="text-sm text-muted-foreground">No deadlines in the next week.</p> : (
                  <ul className="divide-y divide-border">
                    {upcoming.map((t) => (
                      <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                        <Link href={`/tasks/${t.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-primary">{t.title}</Link>
                        <span className="shrink-0 text-xs text-muted-foreground">{formatDate(t.dueDate, ctx.company!.timezone)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle>This week</CardTitle><CardDescription>Your tracked hours.</CardDescription></CardHeader>
              <CardContent className="pt-0">
                <p className="font-display text-[34px] leading-none">{formatDuration(hours.weekSeconds)}</p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(100, (hours.weekSeconds / (40 * 3600)) * 100)}%` }} />
                </div>
                <p className="mt-2.5 text-xs text-muted-foreground">of 40h · {formatDuration(hours.todaySeconds)} today · {formatDuration(hours.monthSeconds)} this month</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Needs you</CardTitle></CardHeader>
              <CardContent className="space-y-2.5 pt-0">
                {work.overdueCount > 0 && (
                  <Link href="/tasks" className="flex items-center gap-3 rounded-2xl bg-danger-soft px-4 py-3 text-sm font-semibold text-tile-danger-fg">
                    <span className="size-2 shrink-0 rounded-full bg-danger" />
                    {work.overdueCount} task{work.overdueCount === 1 ? "" : "s"} overdue
                  </Link>
                )}
                {!reportDone && (
                  <Link href="/daily-report" className="flex items-center gap-3 rounded-2xl bg-warning-soft px-4 py-3 text-sm font-semibold text-tile-warning-fg">
                    <span className="size-2 shrink-0 rounded-full bg-warning" />
                    Daily report not written
                  </Link>
                )}
                {work.overdueCount === 0 && reportDone && <p className="text-sm text-muted-foreground">Nothing needs your attention.</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Your manager</CardTitle><CardDescription>Who to reach when you are blocked.</CardDescription></CardHeader>
              <CardContent className="pt-0">
                {manager ? (
                  <div className="flex items-center gap-3"><Avatar name={manager.name} src={manager.avatarUrl} /><div className="min-w-0"><p className="truncate text-sm font-medium">{manager.name}</p><p className="truncate text-xs text-muted-foreground">{manager.email}</p></div></div>
                ) : <p className="text-sm text-muted-foreground">No manager assigned yet.</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

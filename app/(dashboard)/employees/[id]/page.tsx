import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, ListChecks, FolderKanban, Building2, Mail, Phone, Coffee, Timer, CalendarCheck } from "lucide-react";
import { requirePagePermission, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { ApiError } from "@/lib/api/errors";
import { employeeDetail } from "@/services/employeeService";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ProjectStatusBadge } from "@/components/ui/status-badge";
import { StatsCard } from "@/components/dashboard/stats-card";
import { formatDate, formatDateTime, formatDuration } from "@/lib/utils/dates";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatHMS } from "@/hooks/useTimer";

export const metadata = { title: "Employee" };

const ICON: Record<string, string> = { "timer.started": "bg-success", "timer.stopped": "bg-muted-foreground", "timer.auto_closed": "bg-danger", "attendance.clock_in": "bg-info", "attendance.clock_out": "bg-info", "task.status_changed": "bg-primary", "task.completed": "bg-success" };

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = (await requirePagePermission("employees", "view")) as CompanyContext;
  const { id } = await params;
  await connectDB();
  let d: Awaited<ReturnType<typeof employeeDetail>>;
  try { d = await employeeDetail(ctx, id); } catch (e) { if (e instanceof ApiError && e.status === 404) notFound(); throw e; }
  const p = d.profile;
  const presence = d.onBreakSince ? "Break" : d.current?.status === "RUNNING" ? "Working" : p.lastActiveAt && Date.now() - new Date(p.lastActiveAt).getTime() < 5 * 60_000 ? "Online" : "Offline";
  const presenceVariant = presence === "Working" ? "success" : presence === "Break" ? "warning" : presence === "Online" ? "info" : "outline";

  return (
    <>
      <Link href="/employees" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All employees</Link>
      <PageHeader title={p.name} description={[p.roleLabel, p.designation, p.department, p.team?.name].filter(Boolean).join(" - ")} actions={<Badge variant={presenceVariant}>{presence}</Badge>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-4"><Avatar name={p.name} src={p.avatarUrl} size="xl" /><div className="min-w-0"><p className="truncate text-lg font-semibold">{p.name}</p><p className="truncate text-sm text-muted-foreground">{p.roleLabel}</p><Badge variant={p.status === "active" ? "success" : "danger"} className="mt-1">{p.status}</Badge></div></div>
              <dl className="mt-5 space-y-2.5 text-sm">
                <div className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" /><a href={`mailto:${p.email}`} className="truncate hover:underline">{p.email}</a></div>
                <div className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" /><span>{p.phone ?? "-"}</span></div>
                <div className="flex justify-between border-t border-border pt-2"><dt className="text-muted-foreground">Department</dt><dd>{p.department ?? "-"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Team</dt><dd>{p.team?.name ?? "-"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Manager</dt><dd>{p.manager?.name ?? "-"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Joined</dt><dd>{formatDate(p.joiningDate)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Last active</dt><dd><RelativeTime value={p.lastActiveAt} /></dd></div>
              </dl>
            </CardContent>
          </Card>
          <Card className={d.onBreakSince ? "border-warning/40" : d.current?.status === "RUNNING" ? "border-success/40" : ""}>
            <CardHeader><CardTitle className="flex items-center gap-2">{d.onBreakSince ? <Coffee className="size-4 text-warning" /> : <Timer className="size-4" />}Right now</CardTitle></CardHeader>
            <CardContent className="pt-0 text-sm">
              {d.onBreakSince ? <p>On a break since {formatDateTime(d.onBreakSince).split(", ")[1]}{d.current ? ` - "${d.current.task}" paused at ${formatHMS(d.current.elapsedSeconds)}` : ""}</p>
                : d.current ? <><p className="text-xs text-muted-foreground">{d.current.client} / {d.current.project}</p><Link href={`/tasks/${d.current.taskId}`} className="font-medium hover:text-primary hover:underline">{d.current.task}</Link><p className={`mt-1 font-mono text-2xl tabular-nums ${d.current.status === "RUNNING" ? "text-success" : "text-muted-foreground"}`}>{formatHMS(d.current.elapsedSeconds)}{d.current.status === "PAUSED" && <span className="ml-2 text-xs">paused</span>}</p></>
                : <p className="text-muted-foreground">No timer running.</p>}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-6 xl:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatsCard label="Today" value={formatDuration(d.hours.todaySeconds)} hint={`${formatDuration(d.hours.weekSeconds)} this week`} icon={Clock} tone="success" />
            <StatsCard label="This month" value={formatDuration(d.hours.monthSeconds)} icon={Clock} tone="info" />
            <StatsCard label="Tasks" value={`${d.stats.tasksCompleted} / ${d.stats.tasksCompleted + d.stats.tasksPending}`} hint="completed / total open+done" icon={ListChecks} />
            <StatsCard label="Projects" value={d.stats.projects} hint={`${d.stats.clients} client${d.stats.clients === 1 ? "" : "s"}`} icon={FolderKanban} tone="muted" />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Activity</CardTitle><CardDescription>Timers, attendance and task events.</CardDescription></CardHeader>
              <CardContent className="pt-0">
                {d.activity.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : (
                  <ol className="relative space-y-4 border-l border-border pl-4">
                    {d.activity.map((a) => (
                      <li key={a.id} className="text-sm"><span className={`absolute -left-[5px] mt-1.5 size-2 rounded-full ${ICON[a.action] ?? "bg-border"}`} /><p>{a.summary ?? a.action}</p><p className="text-xs text-muted-foreground"><RelativeTime value={a.createdAt} /></p></li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><CalendarCheck className="size-4" />Recent attendance</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {d.attendance.length === 0 ? <p className="text-sm text-muted-foreground">No records yet.</p> : (
                    <ul className="divide-y divide-border text-sm">{d.attendance.map((a) => <li key={a.id} className="flex items-center justify-between py-2"><span>{formatDate(`${a.date}T12:00:00Z`)}</span><span className="text-muted-foreground">{a.workSeconds ? formatDuration(a.workSeconds) : "-"}</span><Badge variant={a.status === "Present" ? "success" : a.status === "Late" ? "warning" : a.status === "Leave" ? "info" : "danger"}>{a.status}{a.autoClosed ? " (auto)" : ""}</Badge></li>)}</ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-4" />Projects</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {d.projects.length === 0 ? <p className="text-sm text-muted-foreground">Not on any project.</p> : (
                    <ul className="divide-y divide-border text-sm">{d.projects.map((pr) => <li key={pr.id} className="flex items-center justify-between gap-2 py-2"><div className="min-w-0"><Link href={`/projects/${pr.id}`} className="block truncate font-medium hover:text-primary hover:underline">{pr.name}</Link><p className="truncate text-xs text-muted-foreground">{pr.client}</p></div><ProjectStatusBadge status={pr.status} /></li>)}</ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

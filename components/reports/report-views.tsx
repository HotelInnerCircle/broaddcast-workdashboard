"use client";
import Link from "next/link";
import { Clock, Users, ListChecks, AlertTriangle, FolderKanban, Building2, CalendarCheck, FileText } from "lucide-react";
import { StatsCard } from "@/components/dashboard/stats-card";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { PriorityBadge, ProjectStatusBadge, TaskStatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatDateTime, formatDuration } from "@/lib/utils/dates";
import { formatHMS } from "@/hooks/useTimer";
import { cn } from "@/lib/utils/cn";
import { ReportShell } from "./report-shell";
import { EntriesTable } from "./entries-table";
import { ChartCard, HBars, Trend, PairedBars, Donut } from "./charts";

const h = (n: number) => `${n}h`;
const named = (rows: { name: string; hours: number }[]) => rows.slice(0, 8).map((r) => ({ name: r.name, value: r.hours }));
const timeOf = (d: string | Date) => formatDateTime(d).split(", ")[1];

// ------------------------------------------------------------------ Time
interface TimeData { totals: { seconds: number; hours: number; entries: number; people: number; days: number }; days: { date: string; hours: number }[]; byUser: { id: string; name: string; hours: number }[]; byClient: { id: string; name: string; hours: number }[]; byProject: { id: string; name: string; hours: number }[]; entries: { id: string; date: string; user: { id?: string; name: string } | null; client: { name: string | null } | null; project: { name: string | null } | null; task: { id: string; name: string | null } | null; start: string; end: string | null; elapsedSeconds: number; status: string }[] }
export function TimeReportView() {
  return (
    <ReportShell<TimeData> title="Time report" description="Tracked hours by day, employee, client and project. Every figure is a sum of timesheet entries." endpoint="/api/reports/time">
      {(d) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatsCard label="Tracked" value={formatDuration(d.totals.seconds)} hint={`${d.totals.entries} entries`} icon={Clock} tone="success" />
            <StatsCard label="People" value={d.totals.people} icon={Users} tone="info" />
            <StatsCard label="Days with time" value={d.totals.days} />
            <StatsCard label="Avg per day" value={d.totals.days ? formatDuration(Math.round(d.totals.seconds / d.totals.days)) : "-"} tone="muted" />
          </div>
          <ChartCard title="Work over time" description="Hours tracked per day" empty={d.days.length === 0}><Trend data={d.days.map((x) => ({ date: x.date, value: x.hours }))} /></ChartCard>
          <div className="grid gap-6 lg:grid-cols-3">
            <ChartCard title="Hours by employee" empty={d.byUser.length === 0}><HBars data={named(d.byUser)} /></ChartCard>
            <ChartCard title="Hours by client" empty={d.byClient.length === 0}><HBars data={named(d.byClient)} /></ChartCard>
            <ChartCard title="Hours by project" empty={d.byProject.length === 0}><HBars data={named(d.byProject)} /></ChartCard>
          </div>
          <Card>
            <CardHeader><CardTitle>Entries</CardTitle><CardDescription>One line per person per day. Open a line to see the sessions behind it.</CardDescription></CardHeader>
            <CardContent className="p-0 pt-0">
              <EntriesTable entries={d.entries} totalSeconds={d.totals.seconds} />
            </CardContent>
          </Card>
        </div>
      )}
    </ReportShell>
  );
}

// -------------------------------------------------------------- Employees
interface EmpRow { id: string; name: string; avatarUrl: string | null; team: string | null; trackedSeconds: number; trackedHours: number; tasksCompleted: number; tasksOpen: number; tasksOverdue: number; estimatedMinutes: number; actualMinutes: number; projectsWorked: number; clientsWorked: number; dailyReports: number; workingDays: number; attendance: { present: number; late: number; halfDay: number; absent: number; leave: number } }
interface EmpData { rows: EmpRow[]; totals: { trackedSeconds: number; trackedHours: number; tasksCompleted: number; tasksOverdue: number; dailyReports: number; people: number; workingDays: number }; byDay: { date: string; hours: number }[] }
export function EmployeeReportView() {
  return (
    <ReportShell<EmpData> title="Employee report" description="Productivity metrics as transparent numbers only - no opaque score." endpoint="/api/reports/employees">
      {(d) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatsCard label="Tracked hours" value={formatDuration(d.totals.trackedSeconds)} icon={Clock} tone="success" />
            <StatsCard label="Tasks completed" value={d.totals.tasksCompleted} icon={ListChecks} tone="info" />
            <StatsCard label="Tasks overdue" value={d.totals.tasksOverdue} icon={AlertTriangle} tone={d.totals.tasksOverdue ? "danger" : "muted"} />
            <StatsCard label="Daily reports" value={`${d.totals.dailyReports} / ${d.totals.workingDays * d.totals.people}`} hint="submitted / expected" icon={FileText} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Hours by employee" empty={d.rows.every((r) => !r.trackedSeconds)}><HBars data={d.rows.filter((r) => r.trackedSeconds).sort((a, b) => b.trackedSeconds - a.trackedSeconds).slice(0, 8).map((r) => ({ name: r.name, value: r.trackedHours }))} /></ChartCard>
            <ChartCard title="Work over time" empty={d.byDay.length === 0}><Trend data={d.byDay.map((x) => ({ date: x.date, value: x.hours }))} /></ChartCard>
          </div>
          <Card>
            <CardHeader><CardTitle>Per employee</CardTitle><CardDescription>Attendance columns: Present / Late / Half day / Absent / Leave over {d.totals.workingDays} completed working days.</CardDescription></CardHeader>
            <CardContent className="p-0 pt-0">
              <Table cards={false} className="table-sticky-1">
                <THead><TR><TH>Employee</TH><TH className="text-right">Tracked</TH><TH className="text-right">Completed</TH><TH className="text-right">Open</TH><TH className="text-right">Overdue</TH><TH className="text-right">Est / actual</TH><TH className="text-right">Projects</TH><TH className="text-right">Clients</TH><TH className="text-right">Daily reports</TH><TH>Attendance</TH></TR></THead>
                <TBody>{d.rows.map((r) => (
                  <TR key={r.id}>
                    <TD><span className="inline-flex items-center gap-2"><Avatar name={r.name} src={r.avatarUrl} size="sm" /><Link href={`/employees/${r.id}`} className="font-medium hover:underline">{r.name}</Link><span className="text-xs text-muted-foreground">{r.team}</span></span></TD>
                    <TD className="text-right tabular-nums">{formatDuration(r.trackedSeconds)}</TD>
                    <TD className="text-right tabular-nums">{r.tasksCompleted}</TD><TD className="text-right tabular-nums">{r.tasksOpen}</TD>
                    <TD className={cn("text-right tabular-nums", r.tasksOverdue && "font-medium text-danger")}>{r.tasksOverdue}</TD>
                    <TD className="text-right tabular-nums text-muted-foreground">{formatDuration(r.estimatedMinutes * 60)} / {formatDuration(r.actualMinutes * 60)}</TD>
                    <TD className="text-right tabular-nums">{r.projectsWorked}</TD><TD className="text-right tabular-nums">{r.clientsWorked}</TD>
                    <TD className="text-right tabular-nums">{r.dailyReports} / {r.workingDays}</TD>
                    <TD className="whitespace-nowrap text-xs"><span className="text-success">{r.attendance.present}</span> / <span className="text-warning">{r.attendance.late}</span> / <span className="text-danger">{r.attendance.halfDay}</span> / <span className="text-muted-foreground">{r.attendance.absent}</span> / <span className="text-info">{r.attendance.leave}</span></TD>
                  </TR>
                ))}</TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </ReportShell>
  );
}

// ------------------------------------------------------------------ Tasks
interface TaskData { rows: { id: string; title: string; status: string; priority: string; assignee: string | null; project: string | null; client: string | null; dueDate: string | null; overdue: boolean; estimatedMinutes: number | null; actualMinutes: number; trackedInRangeSeconds: number; completedInRange: boolean }[]; summary: { total: number; completedInRange: number; createdInRange: number; overdue: number; open: number; trackedHours: number; estimatedMinutes: number; actualMinutes: number }; byStatus: Record<string, number>; byPriority: Record<string, number> }
export function TaskReportView() {
  return (
    <ReportShell<TaskData> title="Task report" description="Tasks open during the range, with completions, overdue counts and tracked vs estimated time." endpoint="/api/reports/tasks">
      {(d) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
            <StatsCard label="Tasks" value={d.summary.total} hint={`${d.summary.open} open`} icon={ListChecks} />
            <StatsCard label="Completed in range" value={d.summary.completedInRange} tone="success" />
            <StatsCard label="Created in range" value={d.summary.createdInRange} tone="info" />
            <StatsCard label="Overdue now" value={d.summary.overdue} icon={AlertTriangle} tone={d.summary.overdue ? "danger" : "muted"} />
            <StatsCard label="Tracked in range" value={h(d.summary.trackedHours)} hint={`est ${formatDuration(d.summary.estimatedMinutes * 60)} / actual ${formatDuration(d.summary.actualMinutes * 60)}`} icon={Clock} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Tasks by status" empty={d.summary.total === 0}><Donut data={Object.entries(d.byStatus).map(([name, value]) => ({ name, value }))} /></ChartCard>
            <ChartCard title="Tasks by priority" empty={d.summary.total === 0}><HBars data={["Urgent", "High", "Medium", "Low"].filter((p) => d.byPriority[p]).map((p) => ({ name: p, value: d.byPriority[p] }))} unit="" /></ChartCard>
          </div>
          <Card>
            <CardHeader><CardTitle>Tasks</CardTitle></CardHeader>
            <CardContent className="p-0 pt-0">
              <Table cards={false} className="table-sticky-1">
                <THead><TR><TH>Task</TH><TH>Project</TH><TH>Assignee</TH><TH>Priority</TH><TH>Due</TH><TH>Status</TH><TH className="text-right">Est</TH><TH className="text-right">In range</TH><TH className="text-right">Total</TH></TR></THead>
                <TBody>{d.rows.slice(0, 300).map((t) => (
                  <TR key={t.id} className={t.overdue ? "bg-danger-soft/30" : ""}>
                    <TD><Link href={`/tasks/${t.id}`} className="font-medium hover:underline">{t.title}</Link>{t.client && <p className="text-xs text-muted-foreground">{t.client}</p>}</TD>
                    <TD className="text-muted-foreground">{t.project}</TD><TD>{t.assignee ?? <span className="text-muted-foreground">Unassigned</span>}</TD>
                    <TD><PriorityBadge priority={t.priority} /></TD>
                    <TD className={cn("whitespace-nowrap", t.overdue ? "font-medium text-danger" : "text-muted-foreground")}>{t.dueDate ? formatDate(`${t.dueDate}T12:00:00Z`) : "-"}</TD>
                    <TD><TaskStatusBadge status={t.status} /></TD>
                    <TD className="text-right tabular-nums text-muted-foreground">{t.estimatedMinutes != null ? formatDuration(t.estimatedMinutes * 60) : "-"}</TD>
                    <TD className="text-right tabular-nums">{t.trackedInRangeSeconds ? formatDuration(t.trackedInRangeSeconds) : "-"}</TD>
                    <TD className="text-right tabular-nums">{t.actualMinutes ? formatDuration(t.actualMinutes * 60) : "-"}</TD>
                  </TR>
                ))}</TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </ReportShell>
  );
}

// --------------------------------------------------------------- Projects
interface ProjectData { rows: { id: string; name: string; client: string | null; manager: string | null; status: string; archived: boolean; deadline: string | null; tasks: { total: number; completed: number; open: number; overdue: number; progress: number }; estimatedHours: number | null; trackedInRangeHours: number; trackedTotalHours: number; members: number }[]; summary: { projects: number; tasks: number; completed: number; overdue: number; trackedHours: number } }
export function ProjectReportView() {
  return (
    <ReportShell<ProjectData> title="Project report" description="Tasks total / completed / pending / overdue and tracked vs estimated hours per project." endpoint="/api/reports/projects" show={{ employee: true, team: true }}>
      {(d) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatsCard label="Projects" value={d.summary.projects} icon={FolderKanban} />
            <StatsCard label="Tasks" value={d.summary.tasks} hint={`${d.summary.completed} completed`} icon={ListChecks} tone="info" />
            <StatsCard label="Overdue tasks" value={d.summary.overdue} icon={AlertTriangle} tone={d.summary.overdue ? "danger" : "muted"} />
            <StatsCard label="Tracked in range" value={h(d.summary.trackedHours)} icon={Clock} tone="success" />
          </div>
          <ChartCard title="Tracked vs estimated hours" description="All-time tracked hours against the project estimate" empty={d.rows.length === 0}>
            <PairedBars data={d.rows.slice(0, 12).map((p) => ({ name: p.name, tracked: p.trackedTotalHours, estimated: p.estimatedHours ?? 0 }))} aKey="tracked" bKey="estimated" aLabel="Tracked" bLabel="Estimated" />
          </ChartCard>
          <Card>
            <CardHeader><CardTitle>Projects</CardTitle></CardHeader>
            <CardContent className="p-0 pt-0">
              <Table cards={false} className="table-sticky-1">
                <THead><TR><TH>Project</TH><TH>Status</TH><TH className="text-right">Tasks</TH><TH className="text-right">Done</TH><TH className="text-right">Pending</TH><TH className="text-right">Overdue</TH><TH>Progress</TH><TH className="text-right">Estimated</TH><TH className="text-right">In range</TH><TH className="text-right">Total</TH><TH>Deadline</TH></TR></THead>
                <TBody>{d.rows.map((p) => (
                  <TR key={p.id}>
                    <TD><Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link><p className="text-xs text-muted-foreground">{p.client}</p></TD>
                    <TD>{p.archived ? <Badge variant="outline">Archived</Badge> : <ProjectStatusBadge status={p.status} />}</TD>
                    <TD className="text-right tabular-nums">{p.tasks.total}</TD><TD className="text-right tabular-nums">{p.tasks.completed}</TD><TD className="text-right tabular-nums">{p.tasks.open}</TD>
                    <TD className={cn("text-right tabular-nums", p.tasks.overdue && "font-medium text-danger")}>{p.tasks.overdue}</TD>
                    <TD className="min-w-28"><div className="flex items-center gap-2"><ProgressBar value={p.tasks.progress} className="w-20" /><span className="text-xs tabular-nums">{p.tasks.progress}%</span></div></TD>
                    <TD className="text-right tabular-nums text-muted-foreground">{p.estimatedHours != null ? h(p.estimatedHours) : "-"}</TD>
                    <TD className="text-right tabular-nums">{h(p.trackedInRangeHours)}</TD><TD className="text-right tabular-nums">{h(p.trackedTotalHours)}</TD>
                    <TD className="whitespace-nowrap text-muted-foreground">{p.deadline ? formatDate(p.deadline) : "-"}</TD>
                  </TR>
                ))}</TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </ReportShell>
  );
}

// ---------------------------------------------------------------- Clients
interface ClientData { rows: { id: string; name: string; industry: string | null; status: string; archived: boolean; projects: number; tasks: number; openTasks: number; trackedInRangeHours: number; trackedTotalHours: number }[]; summary: { clients: number; projects: number; tasks: number; trackedHours: number }; detail: null | { byEmployee: { id: string; name: string; hours: number }[]; byProject: { id: string; name: string; hours: number }[]; tasksByStatus: Record<string, number>; workOverTime: { date: string; hours: number }[] } }
export function ClientReportView() {
  return (
    <ReportShell<ClientData> title="Client report" description="Totals per client; pick a client for per-employee contribution and charts." endpoint="/api/reports/clients" show={{ project: false }}>
      {(d) => (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <StatsCard label="Clients" value={d.summary.clients} icon={Building2} />
            <StatsCard label="Projects" value={d.summary.projects} icon={FolderKanban} tone="info" />
            <StatsCard label="Tasks" value={d.summary.tasks} icon={ListChecks} />
            <StatsCard label="Hours in range" value={h(d.summary.trackedHours)} icon={Clock} tone="success" />
          </div>
          {d.detail ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <ChartCard title="Hours by employee" description="Per-employee contribution in range" empty={d.detail.byEmployee.length === 0}><HBars data={named(d.detail.byEmployee)} /></ChartCard>
              <ChartCard title="Hours by project" empty={d.detail.byProject.length === 0}><HBars data={named(d.detail.byProject)} /></ChartCard>
              <ChartCard title="Tasks by status" empty={Object.keys(d.detail.tasksByStatus).length === 0}><Donut data={Object.entries(d.detail.tasksByStatus).map(([name, value]) => ({ name, value }))} /></ChartCard>
              <ChartCard title="Work over time" empty={d.detail.workOverTime.length === 0}><Trend data={d.detail.workOverTime.map((x) => ({ date: x.date, value: x.hours }))} /></ChartCard>
            </div>
          ) : (
            <ChartCard title="Hours by client" description="Select a client in the filters for the detailed breakdown" empty={d.rows.every((r) => !r.trackedInRangeHours)}><HBars data={d.rows.filter((r) => r.trackedInRangeHours).sort((a, b) => b.trackedInRangeHours - a.trackedInRangeHours).slice(0, 8).map((r) => ({ name: r.name, value: r.trackedInRangeHours }))} /></ChartCard>
          )}
          <Card>
            <CardHeader><CardTitle>Clients</CardTitle></CardHeader>
            <CardContent className="p-0 pt-0">
              <Table cards={false} className="table-sticky-1">
                <THead><TR><TH>Client</TH><TH>Industry</TH><TH>Status</TH><TH className="text-right">Projects</TH><TH className="text-right">Tasks</TH><TH className="text-right">Open</TH><TH className="text-right">Hours in range</TH><TH className="text-right">Hours total</TH></TR></THead>
                <TBody>{d.rows.map((c) => <TR key={c.id}><TD><Link href={`/clients/${c.id}`} className="font-medium hover:underline">{c.name}</Link></TD><TD className="text-muted-foreground">{c.industry ?? "-"}</TD><TD>{c.archived ? <Badge variant="outline">Archived</Badge> : <Badge variant={c.status === "active" ? "success" : "warning"}>{c.status}</Badge>}</TD><TD className="text-right tabular-nums">{c.projects}</TD><TD className="text-right tabular-nums">{c.tasks}</TD><TD className="text-right tabular-nums">{c.openTasks}</TD><TD className="text-right tabular-nums">{h(c.trackedInRangeHours)}</TD><TD className="text-right tabular-nums">{h(c.trackedTotalHours)}</TD></TR>)}</TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </ReportShell>
  );
}

// ------------------------------------------------------------- Attendance
interface AttData { rows: { id: string; userId: string; user: { name: string; avatarUrl: string | null } | null; date: string; clockIn: string | null; clockOut: string | null; breakSeconds: number; workSeconds: number; status: string; autoClosed: boolean; virtual: boolean }[]; perUser: { id: string; name: string; team: string | null; present: number; late: number; halfDay: number; absent: number; leave: number; workSeconds: number; autoClosed: number }[]; summary: { present: number; late: number; halfDay: number; absent: number; leave: number; flagged: number } }
const ATT: Record<string, "success" | "warning" | "danger" | "outline" | "info"> = { Present: "success", Late: "warning", "Half Day": "danger", Absent: "outline", Leave: "info" };
export function AttendanceReportView() {
  return (
    <ReportShell<AttData> title="Attendance report" description="Present, late, half-day, absent and leave counts per employee, plus every record." endpoint="/api/reports/attendance" show={{ client: false, project: false }}>
      {(d) => (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
            <StatsCard label="Present" value={d.summary.present} tone="success" /><StatsCard label="Late" value={d.summary.late} tone="warning" /><StatsCard label="Half day" value={d.summary.halfDay} tone="danger" /><StatsCard label="Absent" value={d.summary.absent} tone="muted" /><StatsCard label="Leave" value={d.summary.leave} tone="info" /><StatsCard label="Needs review" value={d.summary.flagged} icon={CalendarCheck} tone={d.summary.flagged ? "danger" : "muted"} />
          </div>
          <ChartCard title="Days by status per employee" description="Present, late, half day, absent, leave" empty={d.perUser.length === 0}>
            <Table cards={false} className="table-sticky-1">
              <THead><TR><TH>Employee</TH><TH className="text-right">Present</TH><TH className="text-right">Late</TH><TH className="text-right">Half day</TH><TH className="text-right">Absent</TH><TH className="text-right">Leave</TH><TH className="text-right">Work hours</TH><TH className="text-right">Auto-closed</TH></TR></THead>
              <TBody>{d.perUser.map((u) => <TR key={u.id}><TD><Link href={`/employees/${u.id}`} className="font-medium hover:underline">{u.name}</Link><span className="ml-2 text-xs text-muted-foreground">{u.team}</span></TD><TD className="text-right tabular-nums text-success">{u.present}</TD><TD className="text-right tabular-nums text-warning">{u.late}</TD><TD className="text-right tabular-nums text-danger">{u.halfDay}</TD><TD className="text-right tabular-nums">{u.absent}</TD><TD className="text-right tabular-nums text-info">{u.leave}</TD><TD className="text-right tabular-nums">{formatDuration(u.workSeconds)}</TD><TD className="text-right tabular-nums">{u.autoClosed}</TD></TR>)}</TBody>
            </Table>
          </ChartCard>
          <Card>
            <CardHeader><CardTitle>Records</CardTitle></CardHeader>
            <CardContent className="p-0 pt-0">
              <Table cards={false} className="table-sticky-1">
                <THead><TR><TH>Employee</TH><TH>Date</TH><TH>Clock in</TH><TH>Clock out</TH><TH className="text-right">Break</TH><TH className="text-right">Work</TH><TH>Status</TH></TR></THead>
                <TBody>{d.rows.slice(0, 400).map((r) => <TR key={r.id} className={cn(r.autoClosed && "bg-danger-soft/30", r.virtual && "opacity-70")}><TD><span className="inline-flex items-center gap-2">{r.user && <Avatar name={r.user.name} src={r.user.avatarUrl} size="sm" />}{r.user?.name}</span></TD><TD className="whitespace-nowrap">{formatDate(`${r.date}T12:00:00Z`)}</TD><TD>{r.clockIn ? timeOf(r.clockIn) : "-"}</TD><TD>{r.clockOut ? timeOf(r.clockOut) : "-"}{r.autoClosed && <span className="ml-1 text-[10px] font-semibold uppercase text-danger">auto</span>}</TD><TD className="text-right tabular-nums">{r.breakSeconds ? formatDuration(r.breakSeconds) : "-"}</TD><TD className="text-right tabular-nums">{r.workSeconds ? formatDuration(r.workSeconds) : "-"}</TD><TD><Badge variant={ATT[r.status] ?? "default"}>{r.status}</Badge></TD></TR>)}</TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </ReportShell>
  );
}


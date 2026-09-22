import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ListChecks, Clock, CalendarDays, AlertTriangle, MessageSquare } from "lucide-react";
import { requirePagePermission, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { ApiError } from "@/lib/api/errors";
import { getProject } from "@/services/projectService";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress";
import { PriorityBadge, ProjectStatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatsCard } from "@/components/dashboard/stats-card";
import { ActivityList } from "@/components/dashboard/activity-list";
import { ProjectChat } from "@/components/chat/project-chat";
import { TaskTable } from "@/components/tasks/task-table";
import { ProjectActions } from "@/components/projects/project-actions";
import { formatDate, formatDuration } from "@/lib/utils/dates";
import type { ProjectRow, TaskRow } from "@/components/tasks/types";

export const metadata = { title: "Project" };

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = (await requirePagePermission("projects", "view")) as CompanyContext;
  const { id } = await params;
  await connectDB();
  let project: Awaited<ReturnType<typeof getProject>>;
  try { project = await getProject(ctx, id); } catch (e) { if (e instanceof ApiError && e.status === 404) notFound(); throw e; }
  const canEdit = ctx.role === "COMPANY_ADMIN" || ctx.role === "MANAGER";
  const canCreateTask = ctx.role !== "EMPLOYEE";
  const p = JSON.parse(JSON.stringify(project)) as ProjectRow & { tasks: TaskRow[] };
  const { progress } = p;
  const late = p.daysRemaining !== null && p.daysRemaining < 0 && !["Completed", "Cancelled"].includes(p.status);

  return (
    <>
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All projects</Link>
      <PageHeader
        title={p.name}
        description={p.client?.name ? `Client: ${p.client.name}` : "Project"}
        actions={<div className="flex flex-wrap items-center gap-2"><PriorityBadge priority={p.priority} /><ProjectStatusBadge status={p.status} /><ProjectActions project={p} canEdit={canEdit} canCreateTask={canCreateTask} /></div>}
      />
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="mb-2 flex items-end justify-between"><div><p className="text-sm text-muted-foreground">Progress</p><p className="text-3xl font-semibold tabular-nums">{progress.progress}%</p></div><p className="text-sm text-muted-foreground">{progress.completed} completed / {progress.total - progress.cancelled} tasks{progress.cancelled > 0 && ` (${progress.cancelled} cancelled excluded)`}</p></div>
          <ProgressBar value={progress.progress} className="h-3" />
          {p.description && <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{p.description}</p>}
        </CardContent>
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatsCard label="Tasks remaining" value={progress.open} hint={`${progress.completed} completed`} icon={ListChecks} />
        <StatsCard label="Overdue" value={progress.overdue} icon={AlertTriangle} tone={progress.overdue > 0 ? "danger" : "muted"} />
        <StatsCard label="Tracked vs estimated" value={`${formatDuration(progress.actualMinutes * 60)} / ${p.estimatedHours != null ? `${p.estimatedHours}h` : formatDuration(progress.estimatedMinutes * 60)}`} hint="tracked hours arrive in Phase 3" icon={Clock} tone="info" />
        <StatsCard label="Deadline" value={p.deadline ? formatDate(p.deadline) : "-"} hint={p.daysRemaining === null ? "no deadline" : late ? `${Math.abs(p.daysRemaining)} days late` : `${p.daysRemaining} days remaining`} icon={CalendarDays} tone={late ? "danger" : "success"} />
      </div>

      <Tabs defaultValue="tasks" className="mt-6">
        <TabsList><TabsTrigger value="tasks">Tasks ({p.tasks.length})</TabsTrigger><TabsTrigger value="team">Team ({project.team.length})</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger><TabsTrigger value="chat"><MessageSquare className="mr-1 size-4" />Chat</TabsTrigger></TabsList>
        <TabsContent value="tasks"><Card><CardContent className="p-0"><TaskTable tasks={p.tasks} showProject={false} emptyTitle="No tasks in this project yet" /></CardContent></Card></TabsContent>
        <TabsContent value="team">
          <Card>
            <CardHeader><CardTitle>Team members</CardTitle><CardDescription>Managed by {p.manager?.name ?? "unassigned"}. Assignees are added automatically.</CardDescription></CardHeader>
            <CardContent className="pt-0">
              {project.team.length === 0 ? <p className="text-sm text-muted-foreground">No members yet.</p> : (
                <ul className="grid gap-2 sm:grid-cols-2">{project.team.map((m) => <li key={m.id} className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm"><Avatar name={m.name} src={m.avatarUrl} /><div className="min-w-0 flex-1"><p className="truncate font-medium">{m.name}</p><p className="truncate text-xs text-muted-foreground">{m.team?.name ?? m.email}</p></div><Badge variant="outline">{m.roleLabel}</Badge></li>)}</ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="activity"><ActivityList items={project.activity} title="Project activity" description="Project changes and task events." /></TabsContent>
        <TabsContent value="chat"><ProjectChat projectId={p.id} /></TabsContent>
      </Tabs>
    </>
  );
}

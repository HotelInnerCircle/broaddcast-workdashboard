import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, FolderKanban, ListChecks, Clock, Users, BarChart3, Mail, Phone, Globe } from "lucide-react";
import { requirePagePermission, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { ApiError } from "@/lib/api/errors";
import { getClient } from "@/services/clientService";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ClientStatusBadge } from "@/components/ui/status-badge";
import { StatsCard } from "@/components/dashboard/stats-card";
import { ActivityList } from "@/components/dashboard/activity-list";
import { ProjectCard } from "@/components/projects/project-card";
import { TaskTable } from "@/components/tasks/task-table";
import { ClientActions } from "@/components/clients/client-actions";
import { formatDuration } from "@/lib/utils/dates";
import type { ProjectRow, TaskRow } from "@/components/tasks/types";

export const metadata = { title: "Client" };

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = (await requirePagePermission("clients", "view")) as CompanyContext;
  const { id } = await params;
  await connectDB();
  let client: Awaited<ReturnType<typeof getClient>>;
  try { client = await getClient(ctx, id); } catch (e) { if (e instanceof ApiError && e.status === 404) notFound(); throw e; }
  const canEdit = ctx.role === "COMPANY_ADMIN" || ctx.role === "MANAGER";
  const projects = JSON.parse(JSON.stringify(client.projects)) as ProjectRow[];
  const tasks = JSON.parse(JSON.stringify(client.tasks)) as TaskRow[];

  return (
    <>
      <Link href="/clients" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All clients</Link>
      <PageHeader
        title={client.name}
        description={[client.industry, client.contactPerson].filter(Boolean).join(" - ") || "Client"}
        actions={<div className="flex items-center gap-2"><ClientStatusBadge status={client.status} archived={!!client.archivedAt} />{canEdit && <ClientActions client={JSON.parse(JSON.stringify(client))} />}</div>}
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatsCard label="Projects" value={client.stats.projects} hint={`${client.stats.activeProjects} active`} icon={FolderKanban} />
        <StatsCard label="Tasks" value={client.stats.tasks} hint={`${client.stats.openTasks} open`} icon={ListChecks} tone="info" />
        <StatsCard label="Tracked hours" value={formatDuration(client.stats.trackedMinutes * 60)} hint="Phase 3" icon={Clock} tone="muted" />
        <StatsCard label="People involved" value={client.members.length} icon={Users} tone="success" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <section>
            <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Projects</h2>{canEdit && <Button asChild size="sm" variant="outline"><Link href={`/projects?new=1&clientId=${client.id}`}>New project</Link></Button>}</div>
            {projects.length === 0 ? <Card><EmptyState icon={FolderKanban} title="No projects yet" description="Create a project for this client to start assigning tasks." /></Card> : (
              <div className="grid gap-4 md:grid-cols-2">{projects.map((p) => <ProjectCard key={p.id} project={p} />)}</div>
            )}
          </section>
          <Card>
            <CardHeader><CardTitle>Recent tasks</CardTitle><CardDescription>Latest 50 tasks across this client&apos;s projects.</CardDescription></CardHeader>
            <CardContent className="p-0 pt-0"><TaskTable tasks={tasks} /></CardContent>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-3 pt-0 text-sm">
              <Row icon={Building2} label="Contact" value={client.contactPerson} />
              <Row icon={Mail} label="Email" value={client.email} href={client.email ? `mailto:${client.email}` : undefined} />
              <Row icon={Phone} label="Phone" value={client.phone} />
              <Row icon={Globe} label="Website" value={client.website} href={client.website ?? undefined} />
              {client.notes && <div className="rounded-lg bg-muted/60 p-3 text-muted-foreground whitespace-pre-wrap">{client.notes}</div>}
              <Button variant="outline" className="w-full" disabled><BarChart3 />Client report (Phase 4)</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Assigned employees</CardTitle><CardDescription>Members of this client&apos;s projects.</CardDescription></CardHeader>
            <CardContent className="pt-0">
              {client.members.length === 0 ? <p className="text-sm text-muted-foreground">Nobody assigned yet.</p> : (
                <ul className="space-y-2">{client.members.map((m) => <li key={m.id} className="flex items-center gap-2 text-sm"><Avatar name={m.name} src={m.avatarUrl} size="sm" /><span className="flex-1 truncate">{m.name}</span><Badge variant="outline">{m.roleLabel}</Badge></li>)}</ul>
              )}
            </CardContent>
          </Card>
          <ActivityList items={client.activity} title="Activity" />
        </div>
      </div>
    </>
  );
}

function Row({ icon: Icon, label, value, href }: { icon: typeof Mail; label: string; value: string | null; href?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="w-16 text-xs text-muted-foreground">{label}</span>
      {value ? (href ? <a href={href} className="truncate text-primary hover:underline" target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{value}</a> : <span className="truncate">{value}</span>) : <span className="text-muted-foreground">-</span>}
    </div>
  );
}

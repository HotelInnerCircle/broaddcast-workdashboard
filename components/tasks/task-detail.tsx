"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Archive, ArchiveRestore, Pencil, Paperclip, Play, Square, Trash2, Upload, Clock, CalendarDays, User, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { PriorityBadge, TaskStatusBadge } from "@/components/ui/status-badge";
import { ProgressBar } from "@/components/ui/progress";
import { TaskComments } from "./task-comments";
import { api, ClientApiError } from "@/lib/api/client";
import { showLimitError } from "@/lib/api/limit-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTimer, formatHMS } from "@/hooks/useTimer";
import { cn } from "@/lib/utils/cn";
import { formatDate, formatDateTime, formatDuration } from "@/lib/utils/dates";
import { RelativeTime } from "@/components/ui/relative-time";
import { TASK_STATUSES } from "@/types";
import { TaskDialog } from "./task-dialog";
import type { TaskDetail } from "./types";

export function TaskDetailView({ task }: { task: TaskDetail }) {
  const me = useAuth();
  const timer = useTimer();
  const router = useRouter();
  const timingThis = timer.entry?.task?.id === task.id;
  const closed = task.status === "Completed" || task.status === "Cancelled" || !!task.archivedAt;
  const [edit, setEdit] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canEdit = task.permissions.canEdit;

  const patch = async (body: Record<string, unknown>, okMsg: string) => {
    try { await api(`/api/tasks/${task.id}`, { method: "PATCH", json: body }); toast.success(okMsg); router.refresh(); }
    catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Action failed"); }
  };
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      await api(`/api/tasks/${task.id}/attachments`, { method: "POST", body: fd });
      toast.success("Attachment added"); router.refresh();
    } catch (e) { if (!showLimitError(e)) toast.error(e instanceof ClientApiError ? e.message : "Upload failed"); } finally { setUploading(false); }
  };
  const removeAttachment = async (id: string, name: string) => {
    if (!confirm(`Remove ${name}?`)) return;
    try { await api(`/api/tasks/${task.id}/attachments/${id}`, { method: "DELETE" }); toast.success("Attachment removed"); router.refresh(); }
    catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not remove attachment"); }
  };

  const est = task.estimatedMinutes ?? 0;
  const pct = est > 0 ? Math.min(100, (task.actualMinutes / est) * 100) : 0;

  return (
    <>
      <Link href="/tasks" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />All tasks</Link>
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{task.client?.name && <Link href={`/clients/${task.client.id}`} className="hover:underline">{task.client.name}</Link>}{task.client?.name && task.project?.name && " / "}{task.project?.name && <Link href={`/projects/${task.project.id}`} className="hover:underline">{task.project.name}</Link>}</p>
          <h1 className={cn("mt-1 text-2xl font-semibold tracking-tight", task.archivedAt && "line-through opacity-60")}>{task.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2"><TaskStatusBadge status={task.status} /><PriorityBadge priority={task.priority} />{task.overdue && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">Overdue</span>}{task.archivedAt && <span className="text-xs text-muted-foreground">Archived <RelativeTime value={task.archivedAt} /></span>}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {timingThis ? <Button variant="outline" onClick={() => void timer.stop()}><Square />Stop timer <span className="font-mono tabular-nums">{formatHMS(timer.elapsed)}</span></Button> : <Button disabled={closed} title={closed ? "Reopen the task to track time" : undefined} onClick={() => task.client?.id && void timer.start(task.client.id, { projectId: task.project?.id, taskId: task.id, notes: `Working on ${task.title}` })}><Play />Start timer</Button>}
          <NativeSelect className="w-40" value={task.status} onChange={(e) => patch({ status: e.target.value }, `Moved to ${e.target.value}`)} aria-label="Status" disabled={!!task.archivedAt}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect>
          {canEdit && <Button variant="outline" onClick={() => setEdit(true)} disabled={!!task.archivedAt}><Pencil />Edit</Button>}
          {canEdit && <Button variant="ghost" onClick={() => patch({ archived: !task.archivedAt }, task.archivedAt ? "Task restored" : "Task archived")}>{task.archivedAt ? <><ArchiveRestore />Restore</> : <><Archive />Archive</>}</Button>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader><CardTitle>Description</CardTitle></CardHeader>
            <CardContent className="pt-0">{task.description ? <p className="whitespace-pre-wrap text-sm">{task.description}</p> : <p className="text-sm text-muted-foreground">No description.</p>}</CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div><CardTitle>Attachments</CardTitle><CardDescription>Images, PDF, Word, Excel or PowerPoint, up to 10 MB.</CardDescription></div>
              <input ref={fileRef} type="file" className="hidden" accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.pptx" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
              <Button variant="outline" size="sm" loading={uploading} onClick={() => fileRef.current?.click()} disabled={!!task.archivedAt}><Upload />Upload</Button>
            </CardHeader>
            <CardContent className="pt-0">
              {task.attachments.length === 0 ? <p className="text-sm text-muted-foreground">No attachments yet.</p> : (
                <ul className="divide-y divide-border">
                  {task.attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                      <Paperclip className="size-4 text-muted-foreground" />
                      <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium hover:text-primary hover:underline">{a.name}</a>
                      <span className="text-xs text-muted-foreground">{(a.size / 1024).toFixed(0)} KB</span>
                      {(canEdit || a.uploadedBy === me.userId) && <Button variant="ghost" size="icon" aria-label="Remove attachment" onClick={() => removeAttachment(a.id, a.name)}><Trash2 className="text-danger" /></Button>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <TaskComments taskId={task.id} />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-4 pt-0 text-sm">
              <div className="flex items-center gap-3"><User className="size-4 text-muted-foreground" /><span className="w-20 text-xs text-muted-foreground">Assignee</span>{task.assignee ? <span className="inline-flex items-center gap-2"><Avatar name={task.assignee.name} src={task.assignee.avatarUrl} size="sm" />{task.assignee.name}</span> : <span className="text-muted-foreground">Unassigned</span>}</div>
              <div className="flex items-center gap-3"><CalendarDays className="size-4 text-muted-foreground" /><span className="w-20 text-xs text-muted-foreground">Due</span><span className={task.overdue ? "font-medium text-danger" : ""}>{task.dueDate ? formatDate(task.dueDate) : "-"}</span></div>
              <div className="flex items-center gap-3"><User className="size-4 text-muted-foreground" /><span className="w-20 text-xs text-muted-foreground">Created by</span><span>{task.creator?.name ?? "-"}</span></div>
              <div className="flex items-center gap-3"><Clock className="size-4 text-muted-foreground" /><span className="w-20 text-xs text-muted-foreground">Created</span><span>{formatDateTime(task.createdAt)}</span></div>
              {task.completedAt && <div className="flex items-center gap-3"><Clock className="size-4 text-success" /><span className="w-20 text-xs text-muted-foreground">Completed</span><span>{formatDateTime(task.completedAt)}</span></div>}
              <div>
                <div className="mb-1.5 flex justify-between text-xs"><span className="text-muted-foreground">Tracked vs estimated</span><span className="font-medium">{formatDuration(task.actualMinutes * 60)} / {est ? formatDuration(est * 60) : "-"}</span></div>
                <ProgressBar value={pct} tone="primary" />
                <p className="mt-1 text-[11px] text-muted-foreground">Tracked time is the sum of completed timer entries on this task.</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {task.activity.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : (
                <ol className="relative space-y-4 border-l border-border pl-4">
                  {task.activity.map((a) => (
                    <li key={a.id} className="text-sm">
                      <span className="absolute -left-[5px] mt-1.5 size-2 rounded-full bg-primary" />
                      <p>{a.summary ?? a.action}</p>
                      <p className="text-xs text-muted-foreground">{a.actorName ?? "System"} &middot; <RelativeTime value={a.createdAt} /></p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
          {task.assignee && task.assignee.id !== me.userId && <Button asChild variant="outline" className="w-full"><Link href={`/chat?dm=${task.assignee.id}`}><MessageSquare />Message {task.assignee.name.split(" ")[0]}</Link></Button>}
        </div>
      </div>
      <TaskDialog task={task} open={edit} onClose={() => setEdit(false)} onSaved={() => router.refresh()} />
    </>
  );
}

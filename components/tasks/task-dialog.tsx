"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/api/client";
import { usePickers } from "@/hooks/usePickers";
import { useAuth } from "@/hooks/useAuth";
import { PRIORITIES, TASK_STATUSES } from "@/types";
import type { TaskRow } from "./types";

const schema = z.object({
  projectId: z.string().min(1, "Select a project"),
  title: z.string().trim().min(2, "Title is too short").max(200),
  description: z.string().max(10000).optional(),
  assignedTo: z.string().optional(),
  priority: z.enum(PRIORITIES),
  status: z.enum(TASK_STATUSES),
  dueDate: z.string().optional(),
  estimatedHours: z.string().optional(),
});
type Input = z.infer<typeof schema>;

export function TaskDialog({ task, open, defaultProjectId, defaultAssignee, onClose, onSaved }: { task: TaskRow | null; open: boolean; defaultProjectId?: string | null; defaultAssignee?: string | null; onClose: () => void; onSaved: (t: TaskRow) => void }) {
  const me = useAuth();
  const { projects, people } = usePickers({ projects: open, people: open });
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<Input>({ resolver: zodResolver(schema) });
  const projectId = watch("projectId");
  const project = projects.find((p) => p.id === projectId);
  // Team leads may only assign inside their team (enforced server-side too).
  const assignable = me.role === "TEAM_LEAD" ? people.filter((p) => p.team?.id === me.teamId || p.id === me.userId) : people;

  useEffect(() => {
    if (!open) return;
    reset(task
      ? { projectId: task.project?.id ?? "", title: task.title, description: task.description ?? "", assignedTo: task.assignedTo ?? "", priority: task.priority as Input["priority"], status: task.status as Input["status"], dueDate: task.dueKey ?? "", estimatedHours: task.estimatedMinutes != null ? String(task.estimatedMinutes / 60) : "" }
      : { projectId: defaultProjectId ?? "", title: "", description: "", assignedTo: defaultAssignee ?? "", priority: "Medium", status: "To Do", dueDate: "", estimatedHours: "" });
  }, [task, open, defaultProjectId, defaultAssignee, reset]);

  const onSubmit = async (v: Input) => {
    const body: Record<string, unknown> = {
      title: v.title, description: v.description || null, assignedTo: v.assignedTo || null, priority: v.priority, status: v.status,
      dueDate: v.dueDate || null, estimatedMinutes: v.estimatedHours ? Math.round(Number(v.estimatedHours) * 60) : null,
    };
    try {
      const saved = task ? await api<TaskRow>(`/api/tasks/${task.id}`, { method: "PATCH", json: body }) : await api<TaskRow>("/api/tasks", { method: "POST", json: { ...body, projectId: v.projectId } });
      toast.success(task ? "Task updated" : "Task created");
      onSaved(saved); onClose();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save task"); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={task ? "Edit task" : "New task"} description={project ? `${project.client?.name ?? ""} / ${project.name}` : "Every task belongs to a client and a project."} className="max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          {!task && (
            <Field label="Project" htmlFor="tk-project" error={errors.projectId?.message}>
              <NativeSelect id="tk-project" {...register("projectId")}><option value="">Select a project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.client?.name ? `${p.client.name} / ` : ""}{p.name}</option>)}</NativeSelect>
            </Field>
          )}
          <Field label="Title" htmlFor="tk-title" error={errors.title?.message}><Input id="tk-title" autoFocus {...register("title")} /></Field>
          <Field label="Description" htmlFor="tk-desc"><Textarea id="tk-desc" rows={4} {...register("description")} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Assignee" htmlFor="tk-assignee"><NativeSelect id="tk-assignee" {...register("assignedTo")}><option value="">Unassigned</option>{assignable.map((p) => <option key={p.id} value={p.id}>{p.name}{p.team?.name ? ` - ${p.team.name}` : ""}</option>)}</NativeSelect></Field>
            <Field label="Status" htmlFor="tk-status"><NativeSelect id="tk-status" {...register("status")}>{TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect></Field>
            <Field label="Priority" htmlFor="tk-priority"><NativeSelect id="tk-priority" {...register("priority")}>{PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect></Field>
            <Field label="Due date" htmlFor="tk-due"><Input id="tk-due" type="date" {...register("dueDate")} /></Field>
            <Field label="Estimated hours" htmlFor="tk-est"><Input id="tk-est" type="number" min={0} step="0.25" {...register("estimatedHours")} /></Field>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>{task ? "Save changes" : "Create task"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

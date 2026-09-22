"use client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { api, ClientApiError } from "@/lib/api/client";
import { showLimitError } from "@/lib/api/limit-toast";
import { usePickers } from "@/hooks/usePickers";
import { PRIORITIES, PROJECT_STATUSES } from "@/types";
import type { ProjectRow } from "@/components/tasks/types";

const schema = z.object({
  clientId: z.string().min(1, "Select a client"),
  name: z.string().trim().min(2, "Project name is too short").max(140),
  description: z.string().max(5000).optional(),
  managerId: z.string().optional(),
  memberIds: z.array(z.string()),
  startDate: z.string().optional(),
  deadline: z.string().optional(),
  status: z.enum(PROJECT_STATUSES),
  priority: z.enum(PRIORITIES),
  estimatedHours: z.string().optional(),
  budget: z.string().optional(),
});
type Input = z.infer<typeof schema>;

export function ProjectDialog({ project, open, defaultClientId, onClose, onSaved }: { project: ProjectRow | null; open: boolean; defaultClientId?: string | null; onClose: () => void; onSaved: (p: ProjectRow) => void }) {
  const { clients, people } = usePickers({ clients: open, people: open });
  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isSubmitting } } = useForm<Input>({ resolver: zodResolver(schema) });
  const memberIds = watch("memberIds") ?? [];
  useEffect(() => {
    if (!open) return;
    reset(project
      ? { clientId: project.client?.id ?? "", name: project.name, description: project.description ?? "", managerId: project.manager?.id ?? "", memberIds: project.memberIds, startDate: project.startKey ?? "", deadline: project.deadlineKey ?? "", status: project.status as Input["status"], priority: project.priority as Input["priority"], estimatedHours: project.estimatedHours?.toString() ?? "", budget: project.budget?.toString() ?? "" }
      : { clientId: defaultClientId ?? "", name: "", description: "", managerId: "", memberIds: [], startDate: "", deadline: "", status: "Planning", priority: "Medium", estimatedHours: "", budget: "" });
  }, [project, open, defaultClientId, reset]);

  const onSubmit = async (v: Input) => {
    const body = {
      clientId: v.clientId, name: v.name, description: v.description || null, managerId: v.managerId || null, memberIds: v.memberIds,
      startDate: v.startDate || null, deadline: v.deadline || null, status: v.status, priority: v.priority,
      estimatedHours: v.estimatedHours ? Number(v.estimatedHours) : null, budget: v.budget ? Number(v.budget) : null,
    };
    try {
      const saved = project ? await api<ProjectRow>(`/api/projects/${project.id}`, { method: "PATCH", json: body }) : await api<ProjectRow>("/api/projects", { method: "POST", json: body });
      toast.success(project ? "Project updated" : "Project created");
      onSaved(saved); onClose();
    } catch (e) {
      if (showLimitError(e)) { /* upgrade prompt shown */ }
      else toast.error(e instanceof ClientApiError ? e.message : "Could not save project");
    }
  };
  const toggleMember = (id: string) => setValue("memberIds", memberIds.includes(id) ? memberIds.filter((m) => m !== id) : [...memberIds, id]);
  const managers = people.filter((p) => ["MANAGER", "COMPANY_ADMIN", "TEAM_LEAD"].includes(p.role));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={project ? "Edit project" : "New project"} description="Projects belong to a client and group tasks. Assigning a task adds the person to the project automatically." className="max-w-2xl">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client" htmlFor="pr-client" error={errors.clientId?.message}>
              <NativeSelect id="pr-client" {...register("clientId")}><option value="">Select a client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
            </Field>
            <Field label="Project name" htmlFor="pr-name" error={errors.name?.message}><Input id="pr-name" {...register("name")} /></Field>
          </div>
          <Field label="Description" htmlFor="pr-desc"><Textarea id="pr-desc" rows={3} {...register("description")} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project manager" htmlFor="pr-manager"><NativeSelect id="pr-manager" {...register("managerId")}><option value="">Me</option>{managers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.roleLabel})</option>)}</NativeSelect></Field>
            <Field label="Status" htmlFor="pr-status"><NativeSelect id="pr-status" {...register("status")}>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect></Field>
            <Field label="Start date" htmlFor="pr-start"><Input id="pr-start" type="date" {...register("startDate")} /></Field>
            <Field label="Deadline" htmlFor="pr-deadline"><Input id="pr-deadline" type="date" {...register("deadline")} /></Field>
            <Field label="Priority" htmlFor="pr-priority"><NativeSelect id="pr-priority" {...register("priority")}>{PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect></Field>
            <Field label="Estimated hours" htmlFor="pr-est"><Input id="pr-est" type="number" min={0} step="0.5" {...register("estimatedHours")} /></Field>
          </div>
          <div className="space-y-1.5">
            <Label>Team members <span className="font-normal text-muted-foreground">({memberIds.length} selected)</span></Label>
            <div className="grid max-h-44 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
              {people.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" className="accent-primary" checked={memberIds.includes(p.id)} onChange={() => toggleMember(p.id)} />
                  <Avatar name={p.name} src={p.avatarUrl} size="sm" /><span className="truncate">{p.name}</span><span className="ml-auto text-xs text-muted-foreground">{p.team?.name ?? ""}</span>
                </label>
              ))}
              {people.length === 0 && <p className="p-2 text-sm text-muted-foreground">Loading people...</p>}
            </div>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>{project ? "Save changes" : "Create project"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

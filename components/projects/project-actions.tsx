"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, ClientApiError } from "@/lib/api/client";
import { ProjectDialog } from "./project-dialog";
import { TaskDialog } from "@/components/tasks/task-dialog";
import type { ProjectRow } from "@/components/tasks/types";

export function ProjectActions({ project, canEdit, canCreateTask }: { project: ProjectRow; canEdit: boolean; canCreateTask: boolean }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [task, setTask] = useState(false);
  const toggleArchive = async () => {
    const archiving = !project.archivedAt;
    if (archiving && !confirm(`Archive ${project.name}? Its tasks and history are kept.`)) return;
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", json: { archived: archiving } });
      toast.success(archiving ? "Project archived" : "Project restored");
      router.refresh();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Action failed"); }
  };
  return (
    <>
      {canCreateTask && <Button size="sm" onClick={() => setTask(true)}><Plus />Add task</Button>}
      {canEdit && <Button variant="outline" size="sm" onClick={() => setEdit(true)}><Pencil />Edit</Button>}
      {canEdit && <Button variant="ghost" size="sm" onClick={toggleArchive}>{project.archivedAt ? <><ArchiveRestore />Restore</> : <><Archive />Archive</>}</Button>}
      <ProjectDialog project={project} open={edit} onClose={() => setEdit(false)} onSaved={() => router.refresh()} />
      <TaskDialog task={null} open={task} defaultProjectId={project.id} onClose={() => setTask(false)} onSaved={() => router.refresh()} />
    </>
  );
}

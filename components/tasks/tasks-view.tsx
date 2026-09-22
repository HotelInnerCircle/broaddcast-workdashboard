"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { api, apiPaged, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { usePickers } from "@/hooks/usePickers";
import { cn } from "@/lib/utils/cn";
import { PRIORITIES, TASK_STATUSES } from "@/types";
import { TaskTable } from "./task-table";
import { KanbanBoard } from "./kanban-board";
import { TaskDialog } from "./task-dialog";
import type { TaskRow } from "./types";

export function TasksView() {
  const me = useAuth();
  const params = useSearchParams();
  const canCreate = me.can("tasks", "create");
  const isEmployee = me.role === "EMPLOYEE";
  const { projects, people } = usePickers({ projects: true, people: !isEmployee });
  const [view, setView] = useState<"list" | "board">("list");
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [priority, setPriority] = useState("");
  const [projectId, setProjectId] = useState(params.get("projectId") ?? "");
  const [assignedTo, setAssignedTo] = useState(params.get("assignedTo") ?? "");
  const [mine, setMine] = useState(isEmployee || params.get("mine") === "1");
  const [overdue, setOverdue] = useState(params.get("overdue") === "1");
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(params.get("new") === "1" && canCreate);

  useEffect(() => { try { const v = localStorage.getItem("wp.tasks.view"); if (v === "board" || v === "list") setView(v); } catch {} }, []);
  const switchView = (v: "list" | "board") => { setView(v); try { localStorage.setItem("wp.tasks.view", v); } catch {} };

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(view === "board" ? 1 : page), limit: view === "board" ? "100" : "25", sort: "-createdAt",
        ...(q ? { q } : {}), ...(status && view === "list" ? { status } : {}), ...(priority ? { priority } : {}), ...(projectId ? { projectId } : {}),
        ...(assignedTo ? { assignedTo } : {}), ...(mine ? { mine: "true" } : {}), ...(overdue ? { overdue: "true" } : {}),
      });
      const r = await apiPaged<TaskRow>(`/api/tasks?${qs}`);
      setRows(r.data); setMeta(r.meta);
    } catch (e) { setError(e instanceof ClientApiError ? e.message : "Failed to load tasks"); }
  }, [view, page, q, status, priority, projectId, assignedTo, mine, overdue]);
  useEffect(() => { void load(); }, [load]);

  /** Optimistic move; the server validates, persists and audits (spec 12.9). */
  const move = async (task: TaskRow, next: string) => {
    const prev = rows;
    setRows((rs) => rs?.map((t) => (t.id === task.id ? { ...t, status: next, overdue: next === "Completed" || next === "Cancelled" ? false : t.overdue } : t)) ?? null);
    try {
      const saved = await api<TaskRow>(`/api/tasks/${task.id}`, { method: "PATCH", json: { status: next } });
      setRows((rs) => rs?.map((t) => (t.id === task.id ? { ...t, ...saved, assignee: t.assignee, project: t.project, client: t.client } : t)) ?? null);
      toast.success(`Moved to ${next}`);
    } catch (e) {
      setRows(prev);
      toast.error(e instanceof ClientApiError ? e.message : "Could not move task");
    }
  };

  return (
    <>
      <PageHeader
        title={isEmployee ? "My Tasks" : "Tasks"}
        description={isEmployee ? "Everything assigned to you. Drag cards or use the status menu to update progress." : "All tasks in your scope."}
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-full bg-muted p-1">
              <button className={cn("inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm transition-colors", view === "list" ? "bg-foreground font-medium text-background shadow-sm" : "text-muted-foreground hover:text-foreground")} onClick={() => switchView("list")} aria-pressed={view === "list"}><List className="size-4" />List</button>
              <button className={cn("inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm transition-colors", view === "board" ? "bg-foreground font-medium text-background shadow-sm" : "text-muted-foreground hover:text-foreground")} onClick={() => switchView("board")} aria-pressed={view === "board"}><LayoutGrid className="size-4" />Board</button>
            </div>
            {canCreate && <Button onClick={() => setDialog(true)}><Plus />New task</Button>}
          </div>
        }
      />
      <Card className="mb-6 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-52 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search tasks" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <NativeSelect className="w-44" value={projectId} onChange={(e) => { setProjectId(e.target.value); setPage(1); }}><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
        {view === "list" && <NativeSelect className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect>}
        <NativeSelect className="w-32" value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}><option value="">Any priority</option>{PRIORITIES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect>
        {!isEmployee && <NativeSelect className="w-40" value={assignedTo} onChange={(e) => { setAssignedTo(e.target.value); setMine(false); setPage(1); }}><option value="">Anyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>}
        {!isEmployee && <label className="inline-flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" className="accent-primary" checked={mine} onChange={(e) => { setMine(e.target.checked); setAssignedTo(""); setPage(1); }} />Mine</label>}
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" className="accent-primary" checked={overdue} onChange={(e) => { setOverdue(e.target.checked); setPage(1); }} />Overdue only</label>
      </Card>

      {error ? <ErrorState message={error} onRetry={load} /> : rows === null ? <Card><TableSkeleton rows={6} cols={6} /></Card> : view === "board" ? (
        <KanbanBoard tasks={rows} onMove={move} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <TaskTable tasks={rows} showAssignee={!isEmployee} emptyTitle={mine ? "You're all caught up" : "No tasks match"} emptyAction={canCreate && <Button onClick={() => setDialog(true)}><Plus />Create task</Button>} />
            {meta.totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-muted-foreground"><span>{meta.total} tasks</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button></div></div>
            )}
          </CardContent>
        </Card>
      )}
      <TaskDialog task={null} open={dialog} defaultProjectId={projectId || null} onClose={() => setDialog(false)} onSaved={() => void load()} />
    </>
  );
}

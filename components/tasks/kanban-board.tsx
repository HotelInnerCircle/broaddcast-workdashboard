"use client";
import { useState } from "react";
import Link from "next/link";
import { DndContext, DragOverlay, PointerSensor, KeyboardSensor, TouchSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { Paperclip, GripVertical } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { PriorityBadge } from "@/components/ui/status-badge";
import { NativeSelect } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/dates";
import { KANBAN_COLUMNS, TASK_STATUSES } from "@/types";
import type { TaskRow } from "./types";

/**
 * Kanban (spec 12.9): dropping a card calls onMove -> PATCH /api/tasks/:id {status}.
 * The server owns the transition and writes the audit entry; the UI updates optimistically
 * and reverts on failure. A status select on each card keeps it usable without a pointer.
 */
export function KanbanBoard({ tasks, onMove }: { tasks: TaskRow[]; onMove: (task: TaskRow, status: string) => Promise<void> }) {
  const [active, setActive] = useState<TaskRow | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }), useSensor(KeyboardSensor));
  const columns = KANBAN_COLUMNS.map((status) => ({ status, tasks: tasks.filter((t) => t.status === status) }));
  const other = tasks.filter((t) => !(KANBAN_COLUMNS as readonly string[]).includes(t.status));

  const onDragStart = (e: DragStartEvent) => setActive(tasks.find((t) => t.id === e.active.id) ?? null);
  const onDragEnd = async (e: DragEndEvent) => {
    setActive(null);
    const task = tasks.find((t) => t.id === e.active.id);
    const status = e.over?.id as string | undefined;
    if (!task || !status || status === task.status) return;
    await onMove(task, status);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {columns.map((col) => <Column key={col.status} status={col.status} tasks={col.tasks} onMove={onMove} />)}
      </div>
      {other.length > 0 && (
        <p className="text-xs text-muted-foreground">{other.length} task{other.length === 1 ? "" : "s"} with status Blocked / On Hold / Cancelled are not shown on the board. Switch to the list view to see them.</p>
      )}
      <DragOverlay>{active ? <CardBody task={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, tasks, onMove }: { status: string; tasks: TaskRow[]; onMove: (task: TaskRow, status: string) => Promise<void> }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div ref={setNodeRef} className={cn("flex w-[78vw] max-w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/40 transition-colors sm:w-72", isOver && "border-primary bg-primary-soft/40")}>
      <div className="flex items-center justify-between px-3 py-2.5"><span className="text-sm font-semibold">{status}</span><span className="rounded-full bg-card px-2 py-0.5 text-xs text-muted-foreground">{tasks.length}</span></div>
      <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {tasks.map((t) => <DraggableCard key={t.id} task={t} onMove={onMove} />)}
        {tasks.length === 0 && <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border py-6 text-xs text-muted-foreground">Drop here</div>}
      </div>
    </div>
  );
}

function DraggableCard({ task, onMove }: { task: TaskRow; onMove: (task: TaskRow, status: string) => Promise<void> }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40")}>
      <CardBody task={task} handle={<button type="button" className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing" aria-label={`Drag ${task.title}`} {...listeners} {...attributes}><GripVertical className="size-4" /></button>} onMove={onMove} />
    </div>
  );
}

function CardBody({ task, handle, dragging, onMove }: { task: TaskRow; handle?: React.ReactNode; dragging?: boolean; onMove?: (task: TaskRow, status: string) => Promise<void> }) {
  return (
    <div className={cn("rounded-xl bg-card p-3 shadow-card ring-1 ring-border/60", dragging && "rotate-1 shadow-lg")}>
      <div className="flex items-start gap-1.5">
        {handle}
        <Link href={`/tasks/${task.id}`} className="line-clamp-2 flex-1 text-sm font-medium leading-snug hover:text-primary">{task.title}</Link>
      </div>
      <p className="mt-1 truncate pl-6 text-xs text-muted-foreground">{task.project?.name}</p>
      <div className="mt-3 flex items-center justify-between gap-2 pl-6">
        <div className="flex items-center gap-2">
          <PriorityBadge priority={task.priority} />
          {task.dueDate && <span className={cn("text-[11px]", task.overdue ? "font-medium text-danger" : "text-muted-foreground")}>{formatDate(task.dueDate)}</span>}
          {task.attachmentCount > 0 && <Paperclip className="size-3 text-muted-foreground" />}
        </div>
        {task.assignee ? <Avatar name={task.assignee.name} src={task.assignee.avatarUrl} size="sm" /> : <span className="size-7 rounded-full border border-dashed border-border" title="Unassigned" />}
      </div>
      {onMove && (
        <NativeSelect className="mt-2 ml-6 h-7 w-auto py-0 text-xs" value={task.status} onChange={(e) => void onMove(task, e.target.value)} aria-label="Change status">
          {TASK_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </NativeSelect>
      )}
    </div>
  );
}

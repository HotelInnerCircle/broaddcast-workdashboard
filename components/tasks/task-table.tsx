import Link from "next/link";
import { ListChecks, Paperclip } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { PriorityBadge, TaskStatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import type { TaskRow } from "./types";

export function TaskTable({ tasks, showProject = true, showAssignee = true, emptyAction, emptyTitle = "No tasks" }: { tasks: TaskRow[]; showProject?: boolean; showAssignee?: boolean; emptyAction?: React.ReactNode; emptyTitle?: string }) {
  if (tasks.length === 0) return <EmptyState icon={ListChecks} title={emptyTitle} description="Tasks that match will show up here." action={emptyAction} />;
  return (
    <Table>
      <THead><TR><TH>Task</TH>{showProject && <TH>Project</TH>}{showAssignee && <TH>Assignee</TH>}<TH>Priority</TH><TH>Due</TH><TH>Status</TH></TR></THead>
      <TBody>
        {tasks.map((t) => (
          <TR key={t.id}>
            <TD primary>
              <Link href={`/tasks/${t.id}`} className="font-medium hover:text-primary hover:underline">{t.title}</Link>
              {t.attachmentCount > 0 && <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Paperclip className="size-3" />{t.attachmentCount}</span>}
            </TD>
            {showProject && <TD label="Project" className="text-muted-foreground">{t.project?.name ? <Link href={`/projects/${t.project.id}`} className="hover:underline">{t.project.name}</Link> : "-"}{t.client?.name && <p className="text-xs">{t.client.name}</p>}</TD>}
            {showAssignee && <TD label="Assignee">{t.assignee ? <span className="inline-flex items-center gap-2"><Avatar name={t.assignee.name} src={t.assignee.avatarUrl} size="sm" />{t.assignee.name}</span> : <span className="text-muted-foreground">Unassigned</span>}</TD>}
            <TD label="Priority"><PriorityBadge priority={t.priority} /></TD>
            <TD label="Due" className={cn("whitespace-nowrap", t.overdue ? "font-medium text-danger" : "text-muted-foreground")}>{t.dueDate ? formatDate(t.dueDate) : "-"}{t.overdue && <span className="ml-1 text-[10px] uppercase">overdue</span>}</TD>
            <TD label="Status"><TaskStatusBadge status={t.status} /></TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

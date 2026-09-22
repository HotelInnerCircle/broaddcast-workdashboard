import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils/dates";
import type { TaskRow } from "@/components/tasks/types";

/** "Who needs attention" (spec section 20.1): overdue tasks in scope, oldest first. */
export function OverdueCard({ tasks }: { tasks: TaskRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="size-4 text-danger" />Needs attention</CardTitle><CardDescription>Overdue tasks, oldest first.</CardDescription></CardHeader>
      <CardContent className="pt-0">
        {tasks.length === 0 ? <EmptyState title="Nothing overdue" description="Every task in your scope is on track." className="py-6" /> : (
          <ul className="divide-y divide-border">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                {t.assignee ? <Avatar name={t.assignee.name} src={t.assignee.avatarUrl} size="sm" /> : <span className="size-7 rounded-full border border-dashed border-border" />}
                <div className="min-w-0 flex-1"><Link href={`/tasks/${t.id}`} className="block truncate font-medium hover:text-primary hover:underline">{t.title}</Link><p className="truncate text-xs text-muted-foreground">{t.project?.name}{t.assignee ? ` - ${t.assignee.name}` : " - unassigned"}</p></div>
                <span className="text-xs font-medium text-danger">{formatDate(t.dueDate)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/tasks?overdue=1" className="mt-3 inline-block text-xs text-primary hover:underline">View all overdue</Link>
      </CardContent>
    </Card>
  );
}

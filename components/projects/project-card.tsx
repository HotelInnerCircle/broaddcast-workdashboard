import Link from "next/link";
import { CalendarDays, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { ProgressBar } from "@/components/ui/progress";
import { PriorityBadge, ProjectStatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import type { ProjectRow } from "@/components/tasks/types";

export function ProjectCard({ project: p }: { project: ProjectRow }) {
  const late = p.daysRemaining !== null && p.daysRemaining < 0 && !["Completed", "Cancelled"].includes(p.status);
  return (
    <Card className={cn("flex flex-col transition-shadow hover:shadow-md", p.archivedAt && "opacity-60")}>
      <CardContent className="flex flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/projects/${p.id}`} className="block truncate font-semibold hover:text-primary hover:underline">{p.name}</Link>
            <p className="truncate text-sm text-muted-foreground">{p.client?.name ?? "No client"}</p>
          </div>
          <ProjectStatusBadge status={p.status} />
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-xs text-muted-foreground"><span>{p.progress.completed} of {p.progress.total - p.progress.cancelled} tasks done</span><span className="font-medium text-foreground">{p.progress.progress}%</span></div>
          <ProgressBar value={p.progress.progress} />
        </div>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className={cn("inline-flex items-center gap-1", late && "font-medium text-danger")}><CalendarDays className="size-3.5" />{p.deadline ? formatDate(p.deadline) : "No deadline"}{late && " (late)"}</span>
          <span className="inline-flex items-center gap-1"><Users className="size-3.5" />{p.members.length}</span>
          <PriorityBadge priority={p.priority} />
        </div>
        {p.members.length > 0 && (
          <div className="flex -space-x-2">{p.members.slice(0, 6).map((m) => <Avatar key={m.id} name={m.name} src={m.avatarUrl} size="sm" className="ring-2 ring-card" />)}{p.members.length > 6 && <span className="flex size-7 items-center justify-center rounded-full bg-muted text-[10px] ring-2 ring-card">+{p.members.length - 6}</span>}</div>
        )}
      </CardContent>
    </Card>
  );
}

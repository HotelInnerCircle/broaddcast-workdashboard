import Link from "next/link";
import { Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDuration } from "@/lib/utils/dates";
import { RelativeTime } from "@/components/ui/relative-time";
import { formatHMS } from "@/hooks/useTimer";

export interface StatusRow {
  id: string; name: string; email: string; roleLabel: string; avatarUrl: string | null; team: { name: string } | null; lastActiveAt: Date | string | null;
  presence: "working" | "break" | "online" | "offline";
  current: { client: string | null; project: string | null; task: string | null; taskId: string | null; notes?: string | null; status: string; elapsedSeconds: number } | null;
  breakSince: Date | string | null; todaySeconds: number;
}

const PRESENCE: Record<StatusRow["presence"], { label: string; color: "green" | "amber" | "blue" | "gray" }> = {
  working: { label: "Working", color: "green" }, break: { label: "Break", color: "amber" }, online: { label: "Online", color: "blue" }, offline: { label: "Offline", color: "gray" },
};

/** Live employee status table (spec 12.2). Current on load; Socket.IO updates arrive in Phase 5. */
export function StatusTable({ rows, title = "Employee status", description }: { rows: StatusRow[]; title?: string; description?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description ?? "Timers, breaks and hours as of page load. Live updates arrive in Phase 5."}</CardDescription>
      </CardHeader>
      <CardContent className="p-0 pt-0">
        {rows.length === 0 ? (
          <EmptyState icon={Users} title="No employees in your scope yet" description="Invite people or assign teams to see them here." />
        ) : (
          <Table>
            <THead>
              <TR><TH>Employee</TH><TH className="max-2xl:hidden">Role</TH><TH>Current client</TH><TH>Current project</TH><TH>Current task</TH><TH>Timer</TH><TH>Today</TH><TH>Status</TH><TH className="max-2xl:hidden">Last active</TH><TH /></TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const p = PRESENCE[r.presence];
                return (
                  <TR key={r.id}>
                    <TD primary>
                      <div className="flex items-center gap-3">
                        <Avatar name={r.name} src={r.avatarUrl} size="sm" />
                        <div className="min-w-0"><Link href={`/employees/${r.id}`} className="block truncate font-medium hover:text-primary hover:underline">{r.name}</Link><p className="truncate text-xs text-muted-foreground">{r.team?.name ?? r.email}</p></div>
                      </div>
                    </TD>
                    <TD label="Role" className="max-2xl:hidden"><Badge variant="outline">{r.roleLabel}</Badge></TD>
                    <TD label="Client" className="text-muted-foreground">{r.current?.client ?? "-"}</TD>
                    <TD label="Project" className="text-muted-foreground">{r.current?.project ?? "-"}</TD>
                    <TD label="Working on">{r.current?.task ? <Link href={`/tasks/${r.current.taskId}`} className="hover:text-primary hover:underline">{r.current.task}</Link> : r.current?.notes ? <span className="text-muted-foreground" title={r.current.notes}>{r.current.notes.length > 40 ? r.current.notes.slice(0, 40) + "..." : r.current.notes}</span> : <span className="text-muted-foreground">-</span>}</TD>
                    <TD label="Timer" className="font-mono text-xs tabular-nums">{r.current ? <span className={r.current.status === "RUNNING" ? "text-success" : "text-muted-foreground"}>{formatHMS(r.current.elapsedSeconds)}{r.current.status === "PAUSED" && " (paused)"}</span> : <span className="text-muted-foreground">00:00:00</span>}</TD>
                    <TD label="Today" className="tabular-nums">{r.todaySeconds ? formatDuration(r.todaySeconds) : "-"}</TD>
                    <TD label="Status"><span className="inline-flex items-center gap-1.5 text-xs font-medium"><StatusDot color={p.color} />{p.label}</span></TD>
                    <TD label="Last active" className="text-xs text-muted-foreground max-2xl:hidden"><RelativeTime value={r.lastActiveAt} /></TD>
                    <TD hideOnMobile><Link href={`/employees/${r.id}`} className="text-xs text-primary hover:underline">View</Link></TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

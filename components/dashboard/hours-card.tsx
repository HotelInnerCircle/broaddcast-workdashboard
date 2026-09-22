import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { formatDuration } from "@/lib/utils/dates";
import type { StatusRow } from "./status-table";

/** Tracked hours today per person, largest first (spec 12.1 "work hours" chart, kept simple as bars). */
export function HoursCard({ rows, title = "Work hours today" }: { rows: StatusRow[]; title?: string }) {
  const sorted = [...rows].filter((r) => r.todaySeconds > 0).sort((a, b) => b.todaySeconds - a.todaySeconds).slice(0, 8);
  const max = sorted[0]?.todaySeconds ?? 1;
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>From completed and running timers.</CardDescription></CardHeader>
      <CardContent className="space-y-3 pt-0">
        {sorted.length === 0 ? <p className="text-sm text-muted-foreground">No time tracked yet today.</p> : sorted.map((r) => (
          <div key={r.id} className="flex items-center gap-3 text-sm">
            <Avatar name={r.name} src={r.avatarUrl} size="sm" />
            <span className="w-28 truncate">{r.name}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.round((r.todaySeconds / max) * 100)}%` }} /></div>
            <span className="w-14 text-right tabular-nums text-muted-foreground">{formatDuration(r.todaySeconds)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

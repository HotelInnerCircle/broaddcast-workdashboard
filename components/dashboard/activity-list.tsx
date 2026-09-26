import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

import { RelativeTime } from "@/components/ui/relative-time";

export interface ActivityItem { id: string; summary: string | null; action: string; actorName: string | null; createdAt: Date | string }

export function ActivityList({ items, title = "Recent activity", description }: { items: ActivityItem[]; title?: string; description?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <EmptyState icon={History} title="Nothing yet" description="Audited actions will appear here." className="py-8" />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{a.summary ?? a.action}</p>
                  <p className="text-xs text-muted-foreground">{a.actorName ?? "System"} <span className="mx-1">&middot;</span> <span className="font-mono text-[11px]">{a.action}</span></p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground"><RelativeTime value={a.createdAt} /></span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { api } from "@/lib/api/client";
import { useRealtime } from "@/hooks/useRealtime";
import { relativeTime } from "@/lib/utils/dates";

interface Item { id: string; action: string; summary: string | null; actorName: string | null; createdAt: string }
const DOT: Record<string, string> = { timer: "bg-success", attendance: "bg-info", task: "bg-primary", client: "bg-chart-3", project: "bg-chart-7", announcement: "bg-chart-4", user: "bg-muted-foreground", daily_report: "bg-chart-5" };

/** Live activity feed (spec 12.1): audit entries in scope, prepended as `activity:new` events arrive. */
export function LiveActivity() {
  const rt = useRealtime();
  const [items, setItems] = useState<Item[] | null>(null);
  const load = useCallback(async () => { try { setItems(await api<Item[]>("/api/activity")); } catch { setItems([]); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => rt.subscribe("activity:new", (p) => { const a = p as Item; setItems((xs) => (xs ? [a, ...xs.filter((x) => x.id !== a.id)].slice(0, 25) : xs)); }), [rt]);
  return (
    <Card>
      <CardHeader><CardTitle>Activity feed</CardTitle><CardDescription>{rt.connected ? "Live" : "Reconnecting..."} - timers, tasks, attendance and more.</CardDescription></CardHeader>
      <CardContent className="pt-0">
        {items === null ? <p className="text-sm text-muted-foreground">Loading...</p> : items.length === 0 ? <EmptyState icon={History} title="No activity yet" className="py-6" /> : (
          <ul className="max-h-96 space-y-3 overflow-y-auto text-sm">
            {items.map((a) => (
              <li key={a.id} className="flex items-start gap-2 animate-in">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[a.action.split(".")[0]] ?? "bg-border"}`} />
                <span className="min-w-0 flex-1"><span className="block truncate">{a.summary ?? a.action}</span><span className="text-xs text-muted-foreground">{a.actorName ?? "System"} - {relativeTime(a.createdAt)}</span></span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

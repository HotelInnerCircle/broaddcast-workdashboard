"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TableSkeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { useRealtime } from "@/hooks/useRealtime";
import { relativeTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { TYPE_ICON, type NotificationItem } from "./notification-bell";

export function NotificationsView() {
  const rt = useRealtime();
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const load = useCallback(async () => { try { const r = await api<{ items: NotificationItem[]; unread: number }>(`/api/notifications?limit=100${unreadOnly ? "&unread=true" : ""}`); setItems(r.items); rt.setUnreadNotifications(r.unread); } catch { setItems([]); } }, [unreadOnly, rt]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => rt.subscribe("notification:new", (p) => setItems((xs) => (xs ? [p as NotificationItem, ...xs] : xs))), [rt]);
  const open = async (n: NotificationItem) => { if (!n.readAt) { await api("/api/notifications/read", { method: "POST", json: { ids: [n.id] } }).catch(() => {}); setItems((xs) => xs?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? xs); } if (n.link) router.push(n.link); };
  const readAll = async () => { await api("/api/notifications/read", { method: "POST", json: { ids: "all" } }).catch(() => {}); void load(); };
  return (
    <>
      <PageHeader title="Notifications" description="Tasks, mentions, messages, deadlines and announcements." actions={<div className="flex gap-2"><label className="inline-flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" className="accent-primary" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />Unread only</label><Button variant="outline" size="sm" onClick={readAll}><CheckCheck />Mark all read</Button></div>} />
      <Card>
        <CardContent className="p-0">
          {items === null ? <TableSkeleton rows={6} cols={2} /> : items.length === 0 ? <EmptyState icon={Bell} title="You're all caught up" description="New notifications will appear here in real time." /> : (
            <ul className="divide-y divide-border">{items.map((n) => (
              <li key={n.id}><button onClick={() => open(n)} className={cn("flex w-full items-start gap-3 px-5 py-3 text-left text-sm hover:bg-muted", !n.readAt && "bg-primary-soft/30")}>
                <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", TYPE_ICON[n.type] ?? "bg-muted-foreground")} />
                <span className="min-w-0 flex-1"><span className={cn("block", !n.readAt && "font-medium")}>{n.title}</span>{n.body && <span className="block text-muted-foreground">{n.body}</span>}<span className="text-xs text-muted-foreground">{n.type.replace("_", " ").toLowerCase()} - {relativeTime(n.createdAt)}</span></span>
                {!n.readAt && <span className="mt-2 size-2 rounded-full bg-primary" />}
              </button></li>
            ))}</ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

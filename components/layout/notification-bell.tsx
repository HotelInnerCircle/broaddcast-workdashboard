"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api/client";
import { useRealtime } from "@/hooks/useRealtime";
import { relativeTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

export interface NotificationItem { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }
export const TYPE_ICON: Record<string, string> = { TASK_ASSIGNED: "bg-info", TASK_COMPLETED: "bg-success", TASK_OVERDUE: "bg-danger", TASK_COMMENT: "bg-primary", MENTION: "bg-primary", MESSAGE: "bg-chart-3", PROJECT_UPDATE: "bg-info", DEADLINE: "bg-warning", TIMER: "bg-warning", ANNOUNCEMENT: "bg-chart-7", DAILY_REPORT: "bg-chart-2" };

/** Bell dropdown (spec 12.16): unread visually distinct, mark one / all as read. */
export function NotificationBell() {
  const rt = useRealtime();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const load = useCallback(async () => { try { const r = await api<{ items: NotificationItem[]; unread: number }>("/api/notifications?limit=12"); setItems(r.items); rt.setUnreadNotifications(r.unread); } catch { setItems([]); } }, [rt]);
  useEffect(() => { if (open) void load(); }, [open, load]);
  useEffect(() => rt.subscribe("notification:new", (p) => setItems((xs) => (xs ? [p as NotificationItem, ...xs].slice(0, 12) : xs))), [rt]);

  const openItem = async (n: NotificationItem) => {
    if (!n.readAt) { await api("/api/notifications/read", { method: "POST", json: { ids: [n.id] } }).catch(() => {}); setItems((xs) => xs?.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) ?? xs); }
    setOpen(false);
    if (n.link) router.push(n.link);
  };
  const readAll = async () => { await api("/api/notifications/read", { method: "POST", json: { ids: "all" } }).catch(() => {}); setItems((xs) => xs?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? xs); };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications${rt.unreadNotifications ? ` (${rt.unreadNotifications} unread)` : ""}`} className="relative">
          <Bell />
          {rt.unreadNotifications > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{rt.unreadNotifications > 99 ? "99+" : rt.unreadNotifications}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2"><span className="text-sm font-semibold">Notifications</span><Button variant="ghost" size="sm" onClick={readAll} disabled={!items?.some((i) => !i.readAt)}><CheckCheck />Mark all read</Button></div>
        <div className="max-h-96 overflow-y-auto">
          {items === null ? <p className="p-4 text-sm text-muted-foreground">Loading...</p> : items.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p> : items.map((n) => (
            <button key={n.id} onClick={() => openItem(n)} className={cn("flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted", !n.readAt && "bg-primary-soft/40")}>
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", TYPE_ICON[n.type] ?? "bg-muted-foreground")} />
              <span className="min-w-0 flex-1"><span className={cn("block truncate", !n.readAt && "font-medium")}>{n.title}</span>{n.body && <span className="block truncate text-xs text-muted-foreground">{n.body}</span>}<span className="block text-[11px] text-muted-foreground">{relativeTime(n.createdAt)}</span></span>
              {!n.readAt && <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
        <div className="border-t border-border px-3 py-2 text-center"><Link href="/notifications" onClick={() => setOpen(false)} className="text-xs text-primary hover:underline">View all notifications</Link></div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

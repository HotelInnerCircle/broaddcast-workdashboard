"use client";
import { useState } from "react";
import { Check, CheckCheck, Hash, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { StatusDot } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { ConversationRow, useChat } from "@/hooks/useChat";

type Chat = ReturnType<typeof useChat>;
type Filter = "all" | "unread" | "channels";

/** Short, WhatsApp-ish stamp in the list: time today, "Yesterday", otherwise a date. */
function listTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (Math.round((now.getTime() - d.getTime()) / 86_400_000) <= 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const FILTERS: { key: Filter; label: string }[] = [{ key: "all", label: "All" }, { key: "unread", label: "Unread" }, { key: "channels", label: "Channels" }];

/**
 * Chat list (A72): search, All / Unread / Channels filters, avatar with presence dot, last message
 * with the sender's ticks, timestamp and an unread pill. Rows with something new read louder.
 */
export function ConversationList({ chat, compact = false, onPick, query = "" }: { chat: Chat; compact?: boolean; onPick?: () => void; /** Search text owned by the page, so one box drives both the list and the message search. */ query?: string }) {
  const [tab, setTab] = useState<Filter>("all");
  const rows = chat.conversations;
  const q = query.trim().toLowerCase();
  const list = (rows ?? [])
    .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.lastMessagePreview ?? "").toLowerCase().includes(q))
    .filter((c) => (tab === "unread" ? c.unread > 0 : tab === "channels" ? c.type !== "dm" : true));
  const unreadTotal = (rows ?? []).reduce((n, c) => n + (c.unread > 0 ? 1 : 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!compact && (
        <div className="px-2 pb-2">
          <div className="flex gap-1.5">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setTab(f.key)} className={cn("rounded-full px-2.5 py-1 text-xs font-semibold transition-colors", tab === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-border")}>
                {f.label}{f.key === "unread" && unreadTotal > 0 && ` (${unreadTotal})`}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows === null ? <p className="p-4 text-sm text-muted-foreground">Loading...</p>
          : list.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{q ? "No chats match." : tab === "unread" ? "Nothing unread." : "No conversations yet."}</p>
          : list.map((c) => <Row key={c.id} c={c} active={chat.activeId === c.id} meId={chat.me.userId} onClick={() => { chat.setActiveId(c.id); onPick?.(); }} />)}
      </div>
    </div>
  );
}

function Row({ c, active, meId, onClick }: { c: ConversationRow; active: boolean; meId: string; onClick: () => void }) {
  const mineLast = Boolean(c.lastMessageSenderId && c.lastMessageSenderId === meId);
  return (
    <button onClick={onClick} className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors", active ? "bg-primary-soft" : "hover:bg-muted")}>
      {c.type === "dm" ? (
        <span className="relative shrink-0"><Avatar name={c.name} src={c.avatarUrl} size="md" /><StatusDot color={c.online ? "green" : "gray"} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card" /></span>
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">{c.type === "channel" ? <Users className="size-4.5" /> : <Hash className="size-4.5" />}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", c.unread > 0 ? "font-bold" : "font-medium")}>{c.name.replace(/^# /, "")}</span>
          {c.lastMessageAt && <span className={cn("shrink-0 text-[10px]", c.unread > 0 ? "font-semibold text-primary" : "text-muted-foreground")}>{listTime(c.lastMessageAt)}</span>}
        </span>
        <span className="mt-0.5 flex items-center gap-1">
          {mineLast && (c.lastMessageRead ? <CheckCheck className="size-3.5 shrink-0 text-info" /> : <Check className="size-3.5 shrink-0 text-muted-foreground" />)}
          <span className={cn("min-w-0 flex-1 truncate text-xs", c.unread > 0 ? "font-medium text-foreground" : "text-muted-foreground")}>
            {c.lastMessagePreview ? `${!mineLast && c.type !== "dm" && c.lastMessageSender ? `${c.lastMessageSender.split(" ")[0]}: ` : ""}${c.lastMessagePreview}` : c.type === "channel" && c.description ? c.description : "No messages yet"}
          </span>
          {c.unread > 0 && <span className="ml-1 shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">{c.unread > 99 ? "99+" : c.unread}</span>}
        </span>
      </span>
    </button>
  );
}

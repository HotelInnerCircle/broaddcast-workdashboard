"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MessageSquare, Plus, Search, Hash, ArrowLeft } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusDot } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { useChat, type ConversationRow } from "@/hooks/useChat";
import { api } from "@/lib/api/client";
import { relativeTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { Thread } from "./thread";

interface SearchHit { id: string; conversationId: string; conversation: string; sender: string | null; body: string; createdAt: string }

export function ConversationList({ chat, compact = false, onPick }: { chat: ReturnType<typeof useChat>; compact?: boolean; onPick?: () => void }) {
  const rows = chat.conversations;
  const [filter, setFilter] = useState("");
  const list = (rows ?? []).filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()));
  const groups: [string, ConversationRow[]][] = [["Direct messages", list.filter((c) => c.type === "dm")], ["Team channels", list.filter((c) => c.type === "team")], ["Project channels", list.filter((c) => c.type === "project")]];
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!compact && <div className="relative p-2"><Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Filter conversations" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>}
      <div className="flex-1 overflow-y-auto">
        {rows === null ? <p className="p-4 text-sm text-muted-foreground">Loading...</p> : list.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No conversations yet.</p> : groups.map(([label, items]) => items.length > 0 && (
          <div key={label}>
            <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
            {items.map((c) => (
              <button key={c.id} onClick={() => { chat.setActiveId(c.id); onPick?.(); }} className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted", chat.activeId === c.id && "bg-primary-soft/60")}>
                {c.type === "dm" ? <div className="relative"><Avatar name={c.name} src={c.avatarUrl} size="sm" /><StatusDot color={c.online ? "green" : "gray"} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card" /></div> : <span className="flex size-7 items-center justify-center rounded-full bg-muted text-muted-foreground"><Hash className="size-3.5" /></span>}
                <span className="min-w-0 flex-1"><span className={cn("block truncate text-sm", c.unread > 0 && "font-semibold")}>{c.name.replace(/^# /, "")}</span><span className="block truncate text-xs text-muted-foreground">{c.lastMessagePreview ? `${c.lastMessageSender ? c.lastMessageSender.split(" ")[0] + ": " : ""}${c.lastMessagePreview}` : "No messages yet"}</span></span>
                <span className="flex flex-col items-end gap-1 text-[10px] text-muted-foreground">{c.lastMessageAt && <span>{relativeTime(c.lastMessageAt).replace(" ago", "")}</span>}{c.unread > 0 && <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">{c.unread}</span>}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Full chat page (spec 12.15): conversations on the left, thread on the right; stacked on mobile. */
export function ChatView() {
  const params = useSearchParams();
  const chat = useChat(params.get("c"));
  const [newDm, setNewDm] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  // A62: chat-scoped people list so employees (who cannot list employees) can still start a DM.
  const [people, setPeople] = useState<{ id: string; name: string; avatarUrl: string | null; roleLabel: string; designation: string | null; online: boolean }[]>([]);
  useEffect(() => { if (newDm) api<typeof people>("/api/chat/people").then(setPeople).catch(() => setPeople([])); }, [newDm]);
  useEffect(() => { const c = params.get("c"); if (c) chat.setActiveId(c); const dm = params.get("dm"); if (dm) void chat.openDm(dm); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params]);
  useEffect(() => { if (q.trim().length < 2) { setHits(null); return; } const t = setTimeout(() => api<SearchHit[]>(`/api/chat/search?q=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([])), 250); return () => clearTimeout(t); }, [q]);
  const active = chat.conversations?.find((c) => c.id === chat.activeId);

  return (
    <div className="h-[calc(100dvh-9.5rem)] min-h-[480px] md:h-[calc(100dvh-7.5rem)]">
      <Card className="flex h-full overflow-hidden">
        <aside className={cn("w-full shrink-0 border-r border-border md:w-80", chat.activeId ? "hidden md:flex md:flex-col" : "flex flex-col")}>
          <div className="flex items-center justify-between border-b border-border px-3 py-2"><h1 className="font-semibold">Chat</h1><Button size="sm" variant="outline" onClick={() => setNewDm(true)}><Plus />New message</Button></div>
          <div className="relative border-b border-border p-2"><Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-8" placeholder="Search messages" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          {hits ? (
            <div className="flex-1 overflow-y-auto">{hits.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No messages match.</p> : hits.map((h) => <button key={h.id} onClick={() => { chat.setActiveId(h.conversationId); setQ(""); }} className="block w-full border-b border-border px-3 py-2 text-left text-sm hover:bg-muted"><span className="block truncate">{h.body}</span><span className="text-xs text-muted-foreground">{h.sender} in {h.conversation} - {relativeTime(h.createdAt)}</span></button>)}</div>
          ) : <ConversationList chat={chat} />}
        </aside>
        <section className={cn("min-w-0 flex-1", chat.activeId ? "flex flex-col" : "hidden md:flex md:flex-col")}>
          {active ? (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => chat.setActiveId(null)} aria-label="Back"><ArrowLeft /></Button>
              {active.type === "dm" ? <div className="relative"><Avatar name={active.name} src={active.avatarUrl} size="sm" /><StatusDot color={active.online ? "green" : "gray"} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card" /></div> : <Hash className="size-4 text-muted-foreground" />}
              <div className="min-w-0"><p className="truncate text-sm font-semibold">{active.name.replace(/^# /, "")}</p><p className="text-xs text-muted-foreground">{active.type === "dm" ? (active.online ? "Online" : "Offline") : `${chat.thread?.members.length ?? 0} members, ${chat.thread?.members.filter((m) => m.online).length ?? 0} online`}</p></div>
            </div>
          ) : <div className="hidden md:block" />}
          {chat.activeId ? <Thread chat={chat} /> : <EmptyState icon={MessageSquare} title="Your messages" description="Pick a conversation, or start a new direct message." className="h-full" />}
        </section>
      </Card>
      <Dialog open={newDm} onOpenChange={setNewDm}>
        <DialogContent title="New direct message" description="Pick a teammate.">
          <div className="max-h-80 space-y-1 overflow-y-auto">{people.filter((p) => p.id !== chat.me.userId).map((p) => <button key={p.id} onClick={() => { void chat.openDm(p.id); setNewDm(false); }} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"><Avatar name={p.name} src={p.avatarUrl} size="sm" />{p.name}<span className="ml-auto text-xs text-muted-foreground">{p.roleLabel}</span></button>)}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

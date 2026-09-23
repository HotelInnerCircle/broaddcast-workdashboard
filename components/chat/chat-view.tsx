"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Hash, MessageSquare, MessageSquarePlus, Search, Settings2, Users, Volume2, VolumeX, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusDot } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { useChat } from "@/hooks/useChat";
import { api } from "@/lib/api/client";
import { can } from "@/lib/permissions";
import { relativeTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { askDesktopPermission, playMessageChime, setSoundEnabled, soundEnabled } from "@/lib/chat-sound";
import { ConversationList } from "./conversation-list";
import { ChannelDialog } from "./channel-dialog";
import { Thread } from "./thread";

interface SearchHit { id: string; conversationId: string; conversation: string; sender: string | null; body: string; createdAt: string }
interface Person { id: string; name: string; avatarUrl: string | null; roleLabel: string; designation: string | null; online: boolean }

/** Full chat page (spec 12.15, WhatsApp-style rebuild in A72): list on the left, thread on the right; one at a time on phones. */
export function ChatView() {
  const params = useSearchParams();
  const chat = useChat(params.get("c"));
  const [newDm, setNewDm] = useState(false);
  const [channelDialog, setChannelDialog] = useState<{ open: boolean; id: string | null }>({ open: false, id: null });
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  // A62: chat-scoped people list so employees (who cannot list employees) can still start a DM.
  const [people, setPeople] = useState<Person[]>([]);
  const [personQ, setPersonQ] = useState("");
  // Read from localStorage after mount so the server and the first client render agree (A73).
  const [sound, setSound] = useState(true);
  useEffect(() => { setSound(soundEnabled()); }, []);
  const toggleSound = async () => {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    if (next) { playMessageChime(true); await askDesktopPermission(); }
  };

  useEffect(() => { if (newDm) { setPersonQ(""); api<Person[]>("/api/chat/people").then(setPeople).catch(() => setPeople([])); } }, [newDm]);
  useEffect(() => { const c = params.get("c"); if (c) chat.setActiveId(c); const dm = params.get("dm"); if (dm) void chat.openDm(dm); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params]);
  useEffect(() => { if (q.trim().length < 2) { setHits(null); return; } const t = setTimeout(() => api<SearchHit[]>(`/api/chat/search?q=${encodeURIComponent(q.trim())}`).then(setHits).catch(() => setHits([])), 250); return () => clearTimeout(t); }, [q]);

  const active = chat.conversations?.find((c) => c.id === chat.activeId);
  const canManageChannels = can(chat.me.role, "chat", "manage");
  const members = chat.thread?.members ?? [];
  const onlineCount = members.filter((m) => m.online).length;
  const subtitle = !active ? "" : active.type === "dm"
    ? (Object.keys(chat.typing).length > 0 ? "typing..." : active.online ? "Online" : "Offline")
    : Object.keys(chat.typing).length > 0 ? `${Object.values(chat.typing).map((t) => t.name.split(" ")[0]).join(", ")} typing...`
    : `${members.length} member${members.length === 1 ? "" : "s"}${onlineCount ? `, ${onlineCount} online` : ""}`;
  const filteredPeople = people.filter((p) => p.id !== chat.me.userId && (!personQ.trim() || p.name.toLowerCase().includes(personQ.trim().toLowerCase())));

  return (
    <div className="h-[calc(100dvh-9.5rem)] min-h-[480px] md:h-[calc(100dvh-7.5rem)]">
      <Card className="flex h-full overflow-hidden p-0">
        <aside className={cn("w-full shrink-0 border-r border-border md:w-[21rem]", chat.activeId ? "hidden md:flex md:flex-col" : "flex flex-col")}>
          <div className="flex items-center gap-1 px-3 py-2.5">
            <h1 className="flex-1 text-lg font-semibold">Chats</h1>
            <Button variant="ghost" size="icon" aria-pressed={sound} aria-label={sound ? "Turn message sound off" : "Turn message sound on"} title={sound ? "Message sound is on" : "Message sound is off"} onClick={toggleSound}>{sound ? <Volume2 /> : <VolumeX className="text-muted-foreground" />}</Button>
            <Button variant="ghost" size="icon" aria-label="New direct message" title="New direct message" onClick={() => setNewDm(true)}><MessageSquarePlus /></Button>
            {canManageChannels && <Button variant="ghost" size="icon" aria-label="New channel" title="New channel" onClick={() => setChannelDialog({ open: true, id: null })}><Users /></Button>}
          </div>
          <div className="relative px-2 pb-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="rounded-full pl-9" placeholder="Search chats and messages" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats and messages" />
            {q && <button onClick={() => setQ("")} className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted" aria-label="Clear search"><X className="size-3.5" /></button>}
          </div>
          {/* One box (A72): it narrows the chat list and, from two characters, also searches message text. */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className={cn("min-h-0", hits ? "max-h-1/2 shrink-0 overflow-y-auto" : "flex-1")}><ConversationList chat={chat} query={q} /></div>
            {hits && (
              <div className="min-h-0 flex-1 overflow-y-auto border-t border-border">
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Messages &middot; {hits.length} result{hits.length === 1 ? "" : "s"}</p>
                {hits.length === 0 && <p className="px-3 pb-3 text-sm text-muted-foreground">No messages match.</p>}
                {hits.map((h) => (
                  <button key={h.id} onClick={() => { chat.setActiveId(h.conversationId); setQ(""); }} className="block w-full px-3 py-2 text-left text-sm hover:bg-muted">
                    <span className="block truncate">{h.body}</span>
                    {/* Channel labels already start with "#"; a DM label is just a person's name. */}
                    <span className="text-xs text-muted-foreground">{h.sender} {h.conversation.startsWith("#") ? "in" : "in chat with"} {h.conversation} &middot; {relativeTime(h.createdAt)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <section className={cn("min-w-0 flex-1", chat.activeId ? "flex flex-col" : "hidden md:flex md:flex-col")}>
          {active ? (
            <div className="flex items-center gap-2 border-b border-border bg-card px-2 py-2 md:px-3">
              <Button variant="ghost" size="icon" className="md:hidden" onClick={() => chat.setActiveId(null)} aria-label="Back to chats"><ArrowLeft /></Button>
              {active.type === "dm" ? (
                <span className="relative shrink-0"><Avatar name={active.name} src={active.avatarUrl} size="sm" /><StatusDot color={active.online ? "green" : "gray"} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card" /></span>
              ) : (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">{active.type === "channel" ? <Users className="size-4" /> : <Hash className="size-4" />}</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{active.name.replace(/^# /, "")}</p>
                <p className={cn("truncate text-xs", subtitle.includes("typing") ? "text-info" : "text-muted-foreground")}>{subtitle}</p>
              </div>
              {active.type === "channel" && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Channel menu"><Settings2 /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setChannelDialog({ open: true, id: active.id })}><Users className="size-4" />{active.canManage ? "Channel settings" : "View members"}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ) : <div className="hidden md:block" />}
          {chat.activeId ? <Thread chat={chat} /> : (
            <EmptyState
              icon={MessageSquare}
              title="Your messages"
              description={canManageChannels ? "Pick a conversation, start a direct message, or create a channel for your team." : "Pick a conversation, or start a direct message with a colleague."}
              className="h-full"
              action={<Button onClick={() => setNewDm(true)}><MessageSquarePlus />New message</Button>}
            />
          )}
        </section>
      </Card>

      <Dialog open={newDm} onOpenChange={setNewDm}>
        <DialogContent title="New direct message" description="Pick a colleague to message.">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search people" value={personQ} onChange={(e) => setPersonQ(e.target.value)} aria-label="Search people" />
          </div>
          <div className="max-h-80 space-y-0.5 overflow-y-auto">
            {filteredPeople.length === 0 && <p className="p-3 text-sm text-muted-foreground">Nobody matches.</p>}
            {filteredPeople.map((p) => (
              <button key={p.id} onClick={() => { void chat.openDm(p.id); setNewDm(false); }} className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left text-sm hover:bg-muted">
                <span className="relative shrink-0"><Avatar name={p.name} src={p.avatarUrl} size="sm" /><StatusDot color={p.online ? "green" : "gray"} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card" /></span>
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{p.designation ?? p.roleLabel}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <ChannelDialog
        open={channelDialog.open}
        channelId={channelDialog.id}
        onOpenChange={(v) => setChannelDialog((s) => ({ ...s, open: v }))}
        onSaved={(id) => { void chat.reloadConversations(); chat.setActiveId(id); }}
        onDeleted={() => { chat.setActiveId(null); void chat.reloadConversations(); }}
      />
    </div>
  );
}

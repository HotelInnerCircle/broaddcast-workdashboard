"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";
import type { useChat, ChatMessage } from "@/hooks/useChat";
import { Composer } from "./composer";
import { MessageBubble } from "./message-bubble";
import { Lightbox, type Attachment } from "./attachments";
import { ForwardDialog } from "./forward-dialog";

type Chat = ReturnType<typeof useChat>;

/** Today / Yesterday / "Mon, 12 May" - the pill WhatsApp puts between days. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
}
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
const GROUP_WINDOW_MS = 5 * 60_000;

/** Message thread + composer (spec 12.15, redesigned in A72). Compact mode is used by the dashboard widget. */
export function Thread({ chat, compact = false }: { chat: Chat; compact?: boolean }) {
  const { thread, me, typing } = chat;
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [lightbox, setLightbox] = useState<{ images: Attachment[]; index: number } | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const messages = thread?.messages ?? [];
  const members = thread?.members ?? [];
  const lastId = messages[messages.length - 1]?.id;
  const convId = thread?.conversation.id;

  // Stick to the newest message, but never yank the view away from someone reading history.
  useLayoutEffect(() => { if (atBottom) bottomRef.current?.scrollIntoView({ block: "end" }); }, [lastId, convId, atBottom]);
  useEffect(() => { setAtBottom(true); setReplyTo(null); setEditing(null); }, [convId]);
  const onScroll = () => {
    const el = listRef.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  // Second tick (A72): confirm delivery of everything on screen that someone else sent.
  useEffect(() => {
    const unacked = messages.filter((m) => !m.pending && m.senderId !== me.userId && !m.deliveredTo.some((d) => d.userId === me.userId)).map((m) => m.id);
    if (unacked.length) void chat.confirmDelivered(unacked);
  }, [messages, me.userId, chat]);

  if (!thread) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
        <MessageSquare className="size-8 opacity-40" />
        {chat.loadingThread ? "Loading conversation..." : "Pick a conversation to start chatting."}
      </div>
    );
  }

  const typingNames = Object.values(typing).map((t) => t.name);
  const recipientIds = members.map((m) => m.id);
  const mentionNames = new Set(members.map((m) => m.name));
  const isGroup = thread.conversation.type !== "dm";
  const archived = Boolean(thread.conversation.archived);
  // Where the "unread messages" rule goes: the first thing that arrived after our last read.
  const myRead = thread.conversation.reads.find((r) => r.userId === me.userId)?.at ?? null;
  const firstUnread = myRead ? messages.find((m) => m.senderId !== me.userId && new Date(m.createdAt) > new Date(myRead))?.id ?? null : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={listRef} onScroll={onScroll} className="chat-wallpaper flex-1 overflow-y-auto px-3 py-2 md:px-5">
        {thread.hasMore && <div className="py-2 text-center"><Button variant="outline" size="sm" onClick={() => chat.loadMore()}>Load earlier messages</Button></div>}
        {messages.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No messages yet. Say hello.</p>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
          const run = (a: ChatMessage | undefined, b: ChatMessage) => Boolean(a) && a!.senderId === b.senderId && Math.abs(new Date(b.createdAt).getTime() - new Date(a!.createdAt).getTime()) < GROUP_WINDOW_MS;
          const head = newDay || !run(prev, m);
          const tail = !next || !sameDay(m.createdAt, next.createdAt) || !run(m, next);
          return (
            <div key={m.id}>
              {newDay && <p className="sticky top-1 z-10 my-3 flex justify-center"><span className="rounded-full bg-card/95 px-3 py-1 text-[11px] font-semibold text-muted-foreground shadow-[0_1px_2px_rgb(42_38_32/0.08)] ring-1 ring-border/50 backdrop-blur">{dayLabel(m.createdAt)}</span></p>}
              {firstUnread === m.id && (
                <p className="my-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-info">
                  <span className="h-px flex-1 bg-info/30" />Unread messages<span className="h-px flex-1 bg-info/30" />
                </p>
              )}
              <MessageBubble
                message={m} mine={m.senderId === me.userId} head={head} tail={tail} showName={isGroup && head && m.senderId !== me.userId}
                recipientIds={recipientIds} mentionNames={mentionNames} readOnly={compact || archived}
                onReply={(x) => { setReplyTo(x); setEditing(null); }}
                onForward={setForwarding}
                onEdit={(x) => { setEditing(x); setReplyTo(null); }}
                onDelete={(x) => { if (confirm("Delete this message for everyone?")) void chat.remove(x.id); }}
                onOpenImage={(images, index) => setLightbox({ images, index })}
              />
            </div>
          );
        })}
        {typingNames.length > 0 && (
          <div className="mt-2 flex items-end gap-1.5">
            <div className="w-7 shrink-0">{members.find((mm) => mm.name === typingNames[0]) && <Avatar name={typingNames[0]} src={members.find((mm) => mm.name === typingNames[0])?.avatarUrl} size="sm" />}</div>
            <span className="inline-flex items-center gap-1 rounded-2xl rounded-bl-sm bg-card px-3 py-2.5 ring-1 ring-border/50" aria-label={`${typingNames.join(", ")} typing`}>
              {[0, 1, 2].map((d) => <span key={d} className="typing-dot size-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: `${d * 0.16}s` }} />)}
            </span>
            {isGroup && <span className="text-[11px] text-muted-foreground">{typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing</span>}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {!atBottom && (
        <Button size="icon" variant="outline" onClick={() => { setAtBottom(true); bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }} className="absolute bottom-24 right-4 z-10 rounded-full shadow-float" aria-label="Jump to latest">
          <ChevronDown />
        </Button>
      )}

      <Composer chat={chat} members={members.filter((m) => m.id !== me.userId)} editing={editing} replyTo={replyTo} onClearEdit={() => setEditing(null)} onClearReply={() => setReplyTo(null)} compact={compact} disabled={archived} />
      {lightbox && <Lightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />}
      <ForwardDialog message={forwarding} conversations={chat.conversations ?? []} onForward={chat.forward} onClose={() => setForwarding(null)} />
    </div>
  );
}

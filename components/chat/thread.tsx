"use client";
import { useEffect, useRef, useState } from "react";
import { Paperclip, Reply, Pencil, Trash2, Smile, Send, AtSign, CheckCheck, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { StatusDot } from "@/components/ui/badge";
import { formatDateTime, relativeTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import type { useChat, ChatMessage, Member } from "@/hooks/useChat";

type Chat = ReturnType<typeof useChat>;
const EMOJI = ["😀", "😂", "😊", "😍", "🤔", "😅", "😎", "🙌", "👍", "👏", "🙏", "🔥", "✅", "❌", "🎉", "💯", "🚀", "⏰", "☕", "❤️", "👀", "💡", "📌", "🐛"];

function renderBody(body: string, mentionNames: Set<string>) {
  return body.split(/(@[\w][\w .'-]*?(?=\s@|[,.!?:;]|\s{2}|$))/g).map((part, i) => (part.startsWith("@") && mentionNames.has(part.slice(1).trim()) ? <span key={i} className="rounded bg-primary-soft px-1 font-medium text-primary">{part}</span> : <span key={i}>{part}</span>));
}

/** Message thread + composer (spec 12.15). Compact mode is used by the dashboard widget. */
export function Thread({ chat, compact = false }: { chat: Chat; compact?: boolean }) {
  const { thread, me, typing, reads } = chat;
  const listRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const messages = thread?.messages ?? [];
  const members = thread?.members ?? [];
  const mentionNames = new Set(members.map((m) => m.name));

  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, thread?.conversation.id]);

  if (!thread) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{chat.loadingThread ? "Loading conversation..." : "Pick a conversation to start chatting."}</div>;
  const typingNames = Object.values(typing).map((t) => t.name);
  const others = members.filter((m) => m.id !== me.userId);
  const lastMine = [...messages].reverse().find((m) => m.senderId === me.userId);
  const seenBy = lastMine ? others.filter((m) => reads[m.id] && new Date(reads[m.id]) >= new Date(lastMine.createdAt)) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {thread.hasMore && <div className="text-center"><Button variant="ghost" size="sm" onClick={() => chat.loadMore()}>Load earlier messages</Button></div>}
        {messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No messages yet. Say hello!</p>}
        {messages.map((m, i) => {
          const mine = m.senderId === me.userId;
          const prev = messages[i - 1];
          const grouped = prev && prev.senderId === m.senderId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60_000;
          return (
            <div key={m.id} className={cn("group flex gap-2", mine ? "flex-row-reverse" : "", grouped ? "mt-0.5" : "mt-3")}>
              <div className="w-7 shrink-0">{!grouped && m.sender && <Avatar name={m.sender.name} src={m.sender.avatarUrl} size="sm" />}</div>
              <div className={cn("max-w-[78%] min-w-0", mine ? "items-end text-right" : "")}>
                {!grouped && <p className={cn("mb-0.5 text-[11px] text-muted-foreground", mine && "text-right")}>{mine ? "You" : m.sender?.name} <span title={formatDateTime(m.createdAt)}>{relativeTime(m.createdAt)}</span></p>}
                <div className={cn("relative inline-block rounded-2xl px-3 py-2 text-sm text-left", mine ? "bg-primary text-primary-foreground" : "bg-muted", m.deleted && "italic opacity-70")}>
                  {m.replyTo && <div className={cn("mb-1 border-l-2 pl-2 text-xs opacity-80", mine ? "border-white/60" : "border-primary")}><span className="font-medium">{m.replyTo.sender}</span>: {m.replyTo.body}</div>}
                  {m.deleted ? "Message deleted" : <span className="whitespace-pre-wrap break-words">{renderBody(m.body, mentionNames)}</span>}
                  {m.attachments.map((a) => a.mime.startsWith("image/") ? <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className="mt-2 block"><img src={a.url} alt={a.name} className="max-h-56 rounded-lg" /></a> : <a key={a.id} href={a.url} target="_blank" rel="noreferrer" className={cn("mt-2 flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs underline", mine ? "bg-white/15" : "bg-card")}><Paperclip className="size-3" />{a.name} ({(a.size / 1024).toFixed(0)} KB)</a>)}
                  {m.editedAt && !m.deleted && <span className="ml-1 text-[10px] opacity-70">(edited)</span>}
                </div>
                {!m.deleted && !compact && (
                  <div className={cn("mt-0.5 hidden gap-1 group-hover:flex", mine ? "justify-end" : "")}>
                    <button className="rounded p-1 text-muted-foreground hover:bg-muted" title="Reply" onClick={() => { setReplyTo(m); setEditing(null); }}><Reply className="size-3.5" /></button>
                    {mine && <button className="rounded p-1 text-muted-foreground hover:bg-muted" title="Edit" onClick={() => { setEditing(m); setReplyTo(null); }}><Pencil className="size-3.5" /></button>}
                    {mine && <button className="rounded p-1 text-muted-foreground hover:bg-muted" title="Delete" onClick={() => { if (confirm("Delete this message?")) void chat.remove(m.id); }}><Trash2 className="size-3.5" /></button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {seenBy.length > 0 && <p className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground"><CheckCheck className="size-3 text-info" />Seen by {seenBy.map((s) => s.name.split(" ")[0]).join(", ")}</p>}
        {typingNames.length > 0 && <p className="text-xs text-muted-foreground"><span className="inline-block animate-pulse">{typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing...</span></p>}
      </div>
      <Composer chat={chat} members={others} editing={editing} replyTo={replyTo} onClearEdit={() => setEditing(null)} onClearReply={() => setReplyTo(null)} compact={compact} />
    </div>
  );
}

function Composer({ chat, members, editing, replyTo, onClearEdit, onClearReply, compact }: { chat: Chat; members: Member[]; editing: ChatMessage | null; replyTo: ChatMessage | null; onClearEdit: () => void; onClearReply: () => void; compact: boolean }) {
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) { setText(editing.body); areaRef.current?.focus(); } }, [editing]);

  const query = mentionOpen ? (text.match(/@([\w ]*)$/)?.[1] ?? "") : "";
  const suggestions = mentionOpen ? members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6) : [];
  const insertMention = (m: Member) => { setText((t) => t.replace(/@[\w ]*$/, `@${m.name} `)); setMentions((ms) => (ms.includes(m.id) ? ms : [...ms, m.id])); setMentionOpen(false); areaRef.current?.focus(); };
  const onChange = (v: string) => { setText(v); chat.notifyTyping(); setMentionOpen(/(^|\s)@[\w ]*$/.test(v)); };

  const submit = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    if (editing) { await chat.edit(editing.id, body); onClearEdit(); }
    else { const ok = await chat.send(body, { mentions: mentions.filter((id) => members.some((m) => m.id === id && body.includes(`@${m.name}`))), replyTo: replyTo?.id ?? null }); if (!ok) { setSending(false); return; } onClearReply(); }
    setText(""); setMentions([]); setSending(false);
  };

  return (
    <div className="relative border-t border-border p-2">
      {(replyTo || editing) && (
        <div className="mb-1 flex items-center gap-2 rounded-lg bg-muted px-2 py-1 text-xs"><span className="flex-1 truncate">{editing ? "Editing message" : `Replying to ${replyTo?.sender?.name ?? ""}: ${replyTo?.body.slice(0, 80)}`}</span><button onClick={editing ? onClearEdit : onClearReply} aria-label="Cancel"><X className="size-3.5" /></button></div>
      )}
      {mentionOpen && suggestions.length > 0 && (
        <div className="absolute bottom-full left-2 z-10 mb-1 w-64 rounded-2xl bg-card p-1.5 shadow-float ring-1 ring-border/60">
          {suggestions.map((m) => <button key={m.id} onClick={() => insertMention(m)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"><Avatar name={m.name} src={m.avatarUrl} size="sm" />{m.name}<StatusDot color={m.online ? "green" : "gray"} className="ml-auto" /></button>)}
        </div>
      )}
      {emojiOpen && (
        <div className="absolute bottom-full right-2 z-10 mb-1 grid w-64 grid-cols-8 gap-0.5 rounded-2xl bg-card p-2 shadow-float ring-1 ring-border/60">
          {EMOJI.map((e) => <button key={e} className="rounded p-1 text-lg hover:bg-muted" onClick={() => { setText((t) => t + e); setEmojiOpen(false); areaRef.current?.focus(); }}>{e}</button>)}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <Textarea ref={areaRef} rows={compact ? 1 : 2} value={text} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } if (e.key === "Escape") { setMentionOpen(false); setEmojiOpen(false); } }} placeholder="Write a message... use @ to mention" className="min-h-9 flex-1 resize-none" />
        <input ref={fileRef} type="file" className="hidden" accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.pptx" onChange={(e) => { const f = e.target.files?.[0]; if (f) void chat.sendFile(f, text.trim()).then(() => setText("")); e.target.value = ""; }} />
        <Button variant="ghost" size="icon" aria-label="Mention" onClick={() => { setText((t) => (t.endsWith(" ") || t === "" ? `${t}@` : `${t} @`)); setMentionOpen(true); areaRef.current?.focus(); }}><AtSign /></Button>
        <Button variant="ghost" size="icon" aria-label="Emoji" onClick={() => setEmojiOpen((o) => !o)}><Smile /></Button>
        <Button variant="ghost" size="icon" aria-label="Attach file" onClick={() => fileRef.current?.click()}><Paperclip /></Button>
        <Button size="icon" aria-label="Send" onClick={submit} loading={sending} disabled={!text.trim()}><Send /></Button>
      </div>
    </div>
  );
}

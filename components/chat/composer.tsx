"use client";
import { useEffect, useRef, useState } from "react";
import { AtSign, Paperclip, Plus, Send, Smile, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { StatusDot } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { ChatMessage, Member, useChat } from "@/hooks/useChat";
import { docLook, fileKind, fileSize } from "./attachments";
import { EmojiPicker } from "./emoji-picker";

type Chat = ReturnType<typeof useChat>;
export const ACCEPT = ".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.pptx";
const MAX_FILES = 10;

/** A file chosen but not sent yet. Images carry a local object URL so the preview needs no upload. */
interface Staged { file: File; preview: string | null; id: string }

/**
 * Composer (A72). Files are staged first - images as thumbnails, documents as cards with type and
 * size - so everything can be reviewed, added to and removed before a single send. A caption typed
 * alongside them travels with the same message.
 */
export function Composer({ chat, members, editing, replyTo, onClearEdit, onClearReply, compact = false, disabled = false }: {
  chat: Chat; members: Member[]; editing: ChatMessage | null; replyTo: ChatMessage | null;
  onClearEdit: () => void; onClearReply: () => void; compact?: boolean; disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<Staged[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) { setText(editing.body); setStaged([]); areaRef.current?.focus(); } }, [editing]);
  useEffect(() => { if (replyTo) areaRef.current?.focus(); }, [replyTo]);
  // Object URLs are per-file and revoked as soon as the file leaves the tray.
  useEffect(() => () => { staged.forEach((s) => s.preview && URL.revokeObjectURL(s.preview)); }, [staged]);

  const addFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const room = MAX_FILES - staged.length;
    if (room <= 0) { toast.error(`You can send ${MAX_FILES} files at a time`); return; }
    const picked = Array.from(list).slice(0, room);
    if (picked.length < list.length) toast.error(`Only the first ${room} file${room === 1 ? "" : "s"} were added`);
    setStaged((s) => [...s, ...picked.map((file) => ({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null, id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}` }))]);
    setEmojiOpen(false);
  };
  const dropStaged = (id: string) => setStaged((s) => { const gone = s.find((x) => x.id === id); if (gone?.preview) URL.revokeObjectURL(gone.preview); return s.filter((x) => x.id !== id); });

  const query = mentionOpen ? (text.match(/@([\w ]*)$/)?.[1] ?? "") : "";
  const suggestions = mentionOpen ? members.filter((m) => m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6) : [];
  const insertMention = (m: Member) => { setText((t) => t.replace(/@[\w ]*$/, `@${m.name} `)); setMentions((ms) => (ms.includes(m.id) ? ms : [...ms, m.id])); setMentionOpen(false); areaRef.current?.focus(); };
  const onChange = (v: string) => { setText(v); chat.notifyTyping(); setMentionOpen(/(^|\s)@[\w ]*$/.test(v)); };

  const canSend = (text.trim().length > 0 || staged.length > 0) && !sending && !disabled;
  const submit = async () => {
    if (!canSend) return;
    const body = text.trim();
    setSending(true);
    try {
      if (editing) { await chat.edit(editing.id, body); onClearEdit(); }
      else if (staged.length > 0) { const ok = await chat.sendFiles(staged.map((s) => s.file), body, replyTo?.id ?? null); if (!ok) return; staged.forEach((s) => s.preview && URL.revokeObjectURL(s.preview)); setStaged([]); onClearReply(); }
      else { const ok = await chat.send(body, { mentions: mentions.filter((id) => members.some((m) => m.id === id && body.includes(`@${m.name}`))), replyTo: replyTo?.id ?? null }); if (!ok) return; onClearReply(); }
      setText(""); setMentions([]);
    } finally { setSending(false); }
  };

  if (disabled) return <div className="border-t border-border p-3 text-center text-sm text-muted-foreground">This channel is archived. Nobody can post here.</div>;

  return (
    <div className="relative border-t border-border bg-card px-2 py-2">
      {(replyTo || editing) && (
        <div className="mb-1.5 flex items-center gap-2 rounded-xl border-l-[3px] border-info bg-muted px-2.5 py-1.5 text-xs">
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-info">{editing ? "Editing your message" : `Replying to ${replyTo?.sender?.name ?? ""}`}</span>
            <span className="block truncate text-muted-foreground">{(editing ?? replyTo)?.body?.slice(0, 90) || `${(editing ?? replyTo)?.attachments.length ?? 0} attachment(s)`}</span>
          </span>
          <button onClick={editing ? onClearEdit : onClearReply} aria-label="Cancel" className="rounded p-1 hover:bg-border"><X className="size-3.5" /></button>
        </div>
      )}

      {staged.length > 0 && (
        <div className="mb-2 rounded-xl bg-muted p-2">
          <div className="mb-1.5 flex items-center gap-2 px-0.5">
            <p className="flex-1 text-xs font-semibold">{staged.length} file{staged.length === 1 ? "" : "s"} ready to send</p>
            <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs font-medium text-primary hover:bg-border"><Plus className="size-3.5" />Add more</button>
            <button onClick={() => { staged.forEach((s) => s.preview && URL.revokeObjectURL(s.preview)); setStaged([]); }} className="rounded-lg px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-border">Clear</button>
          </div>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {staged.map((s) => {
              const { icon: Icon, tint } = docLook(s.file.type);
              return (
                <li key={s.id} className="relative shrink-0">
                  <button onClick={() => dropStaged(s.id)} className="absolute -right-1 -top-1 z-10 rounded-full bg-foreground p-0.5 text-background shadow-float" aria-label={`Remove ${s.file.name}`}><X className="size-3" /></button>
                  {s.preview ? (
                    <span className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.preview} alt={s.file.name} className="size-20 rounded-lg object-cover ring-1 ring-border" />
                      <span className="mt-0.5 block w-20 truncate text-[10px] text-muted-foreground">{fileSize(s.file.size)}</span>
                    </span>
                  ) : (
                    <span className="flex h-20 w-36 flex-col justify-center gap-1 rounded-lg bg-card p-2 ring-1 ring-border">
                      <span className={cn("flex size-7 items-center justify-center rounded-md", tint)}><Icon className="size-4" /></span>
                      <span className="truncate text-[11px] font-medium leading-tight">{s.file.name}</span>
                      <span className="text-[10px] text-muted-foreground">{fileKind(s.file.type)} &middot; {fileSize(s.file.size)}</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {mentionOpen && suggestions.length > 0 && (
        <div className="absolute bottom-full left-2 z-20 mb-1 w-64 rounded-2xl bg-card p-1.5 shadow-float ring-1 ring-border/60">
          {suggestions.map((m) => <button key={m.id} onClick={() => insertMention(m)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted"><Avatar name={m.name} src={m.avatarUrl} size="sm" />{m.name}<StatusDot color={m.online ? "green" : "gray"} className="ml-auto" /></button>)}
        </div>
      )}
      {emojiOpen && (
        <EmojiPicker
          className="absolute bottom-full right-2 mb-1"
          onClose={() => setEmojiOpen(false)}
          onPick={(e) => { setText((t) => t + e); areaRef.current?.focus(); }}
        />
      )}

      <div className="flex items-end gap-1">
        <input ref={fileRef} type="file" multiple className="hidden" accept={ACCEPT} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <Button variant="ghost" size="icon" aria-label="Attach files" title="Attach photos or documents" onClick={() => fileRef.current?.click()} disabled={Boolean(editing)}><Paperclip /></Button>
        {!compact && <Button variant="ghost" size="icon" aria-label="Mention someone" title="Mention" onClick={() => { setText((t) => (t.endsWith(" ") || t === "" ? `${t}@` : `${t} @`)); setMentionOpen(true); areaRef.current?.focus(); }}><AtSign /></Button>}
        <Textarea
          ref={areaRef}
          rows={1}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => { const files = e.clipboardData.files; if (files.length) { e.preventDefault(); addFiles(files); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } if (e.key === "Escape") { setMentionOpen(false); setEmojiOpen(false); } }}
          placeholder={staged.length > 0 ? "Add a caption..." : "Write a message"}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl"
        />
        <Button variant="ghost" size="icon" aria-label="Emoji" title="Emoji" onClick={() => setEmojiOpen((o) => !o)}><Smile /></Button>
        <Button size="icon" className="rounded-full" aria-label="Send" onClick={submit} loading={sending} disabled={!canSend}><Send /></Button>
      </div>
    </div>
  );
}

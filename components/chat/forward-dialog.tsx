"use client";
import { useMemo, useState } from "react";
import { Forward, Hash, Search, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusDot } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { ChatMessage, ConversationRow } from "@/hooks/useChat";
import { docLook, isImage } from "./attachments";

const MAX_TARGETS = 10;

/**
 * Forward a message to other chats (A73). Shows what is being forwarded, then a searchable list of
 * every conversation the person can post to; the one it came from is left out.
 */
export function ForwardDialog({ message, conversations, onForward, onClose }: {
  message: ChatMessage | null;
  conversations: ConversationRow[];
  onForward: (messageId: string, conversationIds: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [sending, setSending] = useState(false);

  const targets = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return conversations.filter((c) => c.id !== message?.conversationId).filter((c) => !needle || c.name.toLowerCase().includes(needle));
  }, [conversations, q, message?.conversationId]);

  if (!message) return null;
  const images = message.attachments.filter(isImage);
  const docs = message.attachments.filter((a) => !isImage(a));
  const summary = message.body.trim() || (images.length ? `${images.length} photo${images.length === 1 ? "" : "s"}` : "") || (docs.length ? docs[0].name : "");

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_TARGETS ? p : [...p, id]));
  const send = async () => {
    if (picked.length === 0) return;
    setSending(true);
    const ok = await onForward(message.id, picked);
    setSending(false);
    if (ok) { setPicked([]); setQ(""); onClose(); }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) { setPicked([]); setQ(""); onClose(); } }}>
      <DialogContent title="Forward message" description={`Pick up to ${MAX_TARGETS} chats. Attachments are copied, so they stay even if the original is deleted.`}>
        <div className="space-y-3">
          <div className="rounded-xl bg-muted px-3 py-2 text-sm">
            <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Forwarding</p>
            <p className="line-clamp-2 break-words">{summary || <span className="text-muted-foreground">(empty message)</span>}</p>
            {message.attachments.length > 0 && (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {images.slice(0, 4).map((a) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <li key={a.id}><img src={a.url} alt={a.name} className="size-10 rounded-md object-cover ring-1 ring-border" /></li>
                ))}
                {docs.slice(0, 3).map((a) => {
                  const { icon: Icon, tint } = docLook(a.mime);
                  return <li key={a.id} className={cn("flex size-10 items-center justify-center rounded-md", tint)}><Icon className="size-4" /></li>;
                })}
              </ul>
            )}
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" />
          </div>

          <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-xl bg-muted/50 p-1">
            {targets.length === 0 && <li className="p-3 text-sm text-muted-foreground">No other chats to forward to.</li>}
            {targets.map((c) => {
              const on = picked.includes(c.id);
              const full = !on && picked.length >= MAX_TARGETS;
              return (
                <li key={c.id}>
                  <label className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors", on ? "bg-card ring-1 ring-primary/30" : "hover:bg-card/70", full ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
                    <input type="checkbox" className="size-4 accent-primary" checked={on} disabled={full || sending} onChange={() => toggle(c.id)} aria-label={`Forward to ${c.name}`} />
                    {c.type === "dm" ? (
                      <span className="relative shrink-0"><Avatar name={c.name} src={c.avatarUrl} size="sm" /><StatusDot color={c.online ? "green" : "gray"} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card" /></span>
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">{c.type === "channel" ? <Users className="size-4" /> : <Hash className="size-4" />}</span>
                    )}
                    <span className="min-w-0 flex-1 truncate font-medium">{c.name.replace(/^# /, "")}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={send} loading={sending} disabled={picked.length === 0}><Forward />Forward{picked.length > 0 ? ` to ${picked.length}` : ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

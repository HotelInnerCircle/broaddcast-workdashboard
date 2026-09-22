"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Trash2, AtSign } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { api, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { relativeTime } from "@/lib/utils/dates";

interface Comment { id: string; author: { id: string; name: string; avatarUrl: string | null } | null; body: string; mentions: string[]; createdAt: string }
interface Candidate { id: string; name: string; avatarUrl: string | null }

/** Comments thread on a task (spec 12.9) with @mentions that notify people; live via `task:comment`. */
export function TaskComments({ taskId }: { taskId: string }) {
  const me = useAuth();
  const rt = useRealtime();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const load = useCallback(async () => { try { const r = await api<{ comments: Comment[]; candidates: Candidate[] }>(`/api/tasks/${taskId}/comments`); setComments(r.comments); setCandidates(r.candidates); } catch { setComments([]); } }, [taskId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => rt.subscribe("task:comment", (p) => { if ((p as { taskId: string }).taskId === taskId) void load(); }), [rt, taskId, load]);

  const query = open ? (text.match(/@([\w ]*)$/)?.[1] ?? "") : "";
  const suggestions = open ? candidates.filter((c) => c.id !== me.userId && c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6) : [];
  const insert = (c: Candidate) => { setText((t) => t.replace(/@[\w ]*$/, `@${c.name} `)); setMentions((m) => (m.includes(c.id) ? m : [...m, c.id])); setOpen(false); areaRef.current?.focus(); };
  const names = new Set(candidates.map((c) => c.name));
  const submit = async () => {
    const body = text.trim(); if (!body) return;
    setSending(true);
    try { await api(`/api/tasks/${taskId}/comments`, { method: "POST", json: { body, mentions: mentions.filter((id) => candidates.some((c) => c.id === id && body.includes(`@${c.name}`))) } }); setText(""); setMentions([]); void load(); }
    catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not post comment"); } finally { setSending(false); }
  };
  const remove = async (id: string) => { if (!confirm("Delete this comment?")) return; try { await api(`/api/tasks/${taskId}/comments/${id}`, { method: "DELETE" }); void load(); } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not delete"); } };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="size-4" />Comments</CardTitle><CardDescription>Discussion between employee and manager. Use @ to mention someone; they get notified.</CardDescription></CardHeader>
      <CardContent className="space-y-4 pt-0">
        {comments === null ? <p className="text-sm text-muted-foreground">Loading...</p> : comments.length === 0 ? <p className="text-sm text-muted-foreground">No comments yet.</p> : (
          <ul className="space-y-4">{comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              {c.author && <Avatar name={c.author.name} src={c.author.avatarUrl} size="sm" />}
              <div className="min-w-0 flex-1 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2"><span className="font-medium">{c.author?.name ?? "Unknown"}</span><span className="flex items-center gap-2 text-xs text-muted-foreground">{relativeTime(c.createdAt)}{(c.author?.id === me.userId || me.role === "COMPANY_ADMIN" || me.role === "MANAGER") && <button onClick={() => remove(c.id)} aria-label="Delete comment" className="hover:text-danger"><Trash2 className="size-3.5" /></button>}</span></div>
                <p className="mt-1 whitespace-pre-wrap">{c.body.split(/(@[\w][\w .'-]*?(?=\s@|[,.!?:;]|\s{2}|$))/g).map((part, i) => (part.startsWith("@") && names.has(part.slice(1).trim()) ? <span key={i} className="rounded bg-primary-soft px-1 font-medium text-primary">{part}</span> : <span key={i}>{part}</span>))}</p>
              </div>
            </li>
          ))}</ul>
        )}
        <div className="relative">
          {open && suggestions.length > 0 && <div className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-2xl bg-card p-1.5 shadow-float ring-1 ring-border/60">{suggestions.map((c) => <button key={c.id} onClick={() => insert(c)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"><Avatar name={c.name} src={c.avatarUrl} size="sm" />{c.name}</button>)}</div>}
          <div className="flex items-end gap-2">
            <Textarea ref={areaRef} rows={2} value={text} onChange={(e) => { setText(e.target.value); setOpen(/(^|\s)@[\w ]*$/.test(e.target.value)); }} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit(); if (e.key === "Escape") setOpen(false); }} placeholder="Write a comment... @mention to notify" className="flex-1 resize-none" />
            <Button variant="ghost" size="icon" aria-label="Mention" onClick={() => { setText((t) => (t.endsWith(" ") || t === "" ? `${t}@` : `${t} @`)); setOpen(true); areaRef.current?.focus(); }}><AtSign /></Button>
            <Button size="icon" aria-label="Post comment" onClick={submit} loading={sending} disabled={!text.trim()}><Send /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

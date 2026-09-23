"use client";
import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusDot } from "@/components/ui/badge";
import { api, ClientApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";

interface Person { id: string; name: string; avatarUrl: string | null; roleLabel: string; designation: string | null; online: boolean }
interface Detail { id: string; name: string; description: string | null; archived: boolean; ownerId: string | null; canManage: boolean; memberIds: string[]; people: Person[] }

/**
 * Create or manage a channel (A72). One dialog does both: with no `channelId` it creates, with one
 * it loads the channel and lets its owner rename it, edit the description, change the member list,
 * archive it (history kept, nobody can post) or delete it outright.
 */
export function ChannelDialog({ open, onOpenChange, channelId, onSaved, onDeleted }: {
  open: boolean; onOpenChange: (v: boolean) => void; channelId?: string | null;
  onSaved: (id: string) => void; onDeleted?: () => void;
}) {
  const editing = Boolean(channelId);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQ(""); setDetail(null);
    if (channelId) {
      api<Detail>(`/api/chat/channels/${channelId}`, { fresh: true })
        .then((d) => { setDetail(d); setPeople(d.people); setName(d.name); setDescription(d.description ?? ""); setMembers(d.memberIds); })
        .catch((e) => { toast.error(e instanceof ClientApiError ? e.message : "Could not load the channel"); onOpenChange(false); });
    } else {
      setName(""); setDescription(""); setMembers([]);
      api<Person[]>("/api/chat/people").then(setPeople).catch(() => setPeople([]));
    }
  }, [open, channelId, onOpenChange]);

  const readOnly = editing && detail !== null && !detail.canManage;
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return people.filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.designation ?? "").toLowerCase().includes(needle));
  }, [people, q]);
  const toggle = (id: string) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const save = async () => {
    if (name.trim().length < 2) { toast.error("Give the channel a name"); return; }
    setSaving(true);
    try {
      const body = { name: name.trim(), description: description.trim() || null, members };
      const res = editing
        ? await api<{ id: string }>(`/api/chat/channels/${channelId}`, { method: "PATCH", json: body })
        : await api<{ id: string }>("/api/chat/channels", { method: "POST", json: body });
      toast.success(editing ? "Channel updated" : `# ${name.trim()} created`);
      onSaved(res.id);
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save the channel"); }
    finally { setSaving(false); }
  };

  const setArchived = async (archived: boolean) => {
    setSaving(true);
    try { await api(`/api/chat/channels/${channelId}`, { method: "PATCH", json: { archived } }); toast.success(archived ? "Channel archived" : "Channel restored"); onSaved(channelId!); onOpenChange(false); }
    catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not change the channel"); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!confirm(`Delete # ${detail?.name}? Every message and file in it is removed for everyone. This cannot be undone.`)) return;
    setSaving(true);
    try { await api(`/api/chat/channels/${channelId}`, { method: "DELETE" }); toast.success("Channel deleted"); onDeleted?.(); onOpenChange(false); }
    catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not delete the channel"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={editing ? "Channel settings" : "New channel"} description={editing ? "Rename the channel, change who is in it, or archive it." : "Channels are for a group of people. Only the people you add can see it."}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ch-name">Name</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">#</span>
              <Input id="ch-name" className="pl-7" value={name} onChange={(e) => setName(e.target.value)} placeholder="design-reviews" maxLength={60} disabled={readOnly} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ch-desc">What is it for? <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="ch-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Weekly creative reviews with the client team" maxLength={280} disabled={readOnly} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Members <span className="font-normal text-muted-foreground">({members.length} + you)</span></Label>
              {!readOnly && members.length > 0 && <button type="button" onClick={() => setMembers([])} className="text-xs font-medium text-muted-foreground hover:text-foreground">Clear</button>}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
            </div>
            <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-xl bg-muted/50 p-1">
              {shown.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nobody matches.</li>}
              {shown.map((p) => {
                const on = members.includes(p.id);
                return (
                  <li key={p.id}>
                    <label className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors", on ? "bg-card ring-1 ring-primary/30" : "hover:bg-card/70", readOnly && "cursor-not-allowed opacity-70")}>
                      <input type="checkbox" className="size-4 accent-primary" checked={on} disabled={readOnly} onChange={() => toggle(p.id)} aria-label={`${on ? "Remove" : "Add"} ${p.name}`} />
                      <span className="relative shrink-0"><Avatar name={p.name} src={p.avatarUrl} size="sm" /><StatusDot color={p.online ? "green" : "gray"} className="absolute -bottom-0.5 -right-0.5 ring-2 ring-card" /></span>
                      <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{p.designation ?? p.roleLabel}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {readOnly && <p className="text-xs text-muted-foreground">Only the channel owner or a company admin can change this.</p>}
          </div>
        </div>
        <DialogFooter className="flex-wrap gap-2">
          {editing && detail?.canManage && (
            <div className="mr-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void setArchived(!detail.archived)} disabled={saving}>
                {detail.archived ? <><ArchiveRestore />Restore</> : <><Archive />Archive</>}
              </Button>
              <Button variant="outline" size="sm" className="text-danger" onClick={remove} disabled={saving}><Trash2 />Delete</Button>
            </div>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!readOnly && <Button onClick={save} loading={saving}><Users />{editing ? "Save changes" : "Create channel"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

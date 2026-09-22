"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Megaphone, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { formatDateTime } from "@/lib/utils/dates";

interface Item { id: string; title: string; body: string; author: { name: string; avatarUrl: string | null } | null; createdAt: string }

/** Announcements (spec 12.21): admins/managers post; everyone sees the history and gets notified. */
export function AnnouncementsView() {
  const me = useAuth();
  const rt = useRealtime();
  const params = useSearchParams();
  const canCreate = me.can("announcements", "create");
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(params.get("new") === "1" && canCreate);
  const [form, setForm] = useState({ title: "", body: "" });
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => { try { setItems(await api<Item[]>("/api/announcements")); } catch { setItems([]); } }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => rt.subscribe("announcement:new", () => void load()), [rt, load]);
  const submit = async () => {
    setSaving(true);
    try { await api("/api/announcements", { method: "POST", json: form }); toast.success("Announcement posted - everyone has been notified"); setOpen(false); setForm({ title: "", body: "" }); void load(); }
    catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not post"); } finally { setSaving(false); }
  };
  return (
    <>
      <PageHeader title="Announcements" description="Company-wide notices. Everyone receives a notification." actions={canCreate && <Button onClick={() => setOpen(true)}><Plus />New announcement</Button>} />
      {items === null ? <Skeleton className="h-40" /> : items.length === 0 ? <Card><EmptyState icon={Megaphone} title="No announcements yet" description={canCreate ? "Post the first one." : "Nothing has been announced yet."} action={canCreate && <Button onClick={() => setOpen(true)}><Plus />New announcement</Button>} /></Card> : (
        <div className="space-y-4">{items.map((a) => (
          <Card key={a.id}><CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary"><Megaphone className="size-5" /></div>
              <div className="min-w-0 flex-1"><h2 className="font-semibold">{a.title}</h2><p className="mt-1 whitespace-pre-wrap text-sm">{a.body}</p><p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">{a.author && <Avatar name={a.author.name} src={a.author.avatarUrl} size="sm" />}{a.author?.name ?? "Unknown"} - {formatDateTime(a.createdAt)}</p></div>
            </div>
          </CardContent></Card>
        ))}</div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="New announcement" description="Posted to everyone in the company.">
          <div className="space-y-4">
            <Field label="Title" htmlFor="an-title"><Input id="an-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Office closed tomorrow" /></Field>
            <Field label="Message" htmlFor="an-body"><Textarea id="an-body" rows={5} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} /></Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} loading={saving} disabled={form.title.trim().length < 2 || !form.body.trim()}>Post announcement</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

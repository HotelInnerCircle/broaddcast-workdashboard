"use client";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ClientApiError } from "@/lib/api/client";
import type { PlanDto } from "@/components/settings/subscription-view";

/** Super Admin plan editor (spec section 15): limits, price, features and the default for new signups. */
export function PlansEditor() {
  const [plans, setPlans] = useState<PlanDto[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { users: string; projects: string; clients: string; storageMB: string; price: string; features: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const load = async () => { const p = await api<PlanDto[]>("/api/super-admin/plans"); setPlans(p); setDrafts(Object.fromEntries(p.map((x) => [x.id, { users: String(x.limits.users), projects: String(x.limits.projects), clients: String(x.limits.clients), storageMB: String(x.limits.storageMB), price: String(x.price), features: x.features.join(", ") }]))); };
  useEffect(() => { void load(); }, []);
  const save = async (id: string, isDefault?: boolean) => {
    const d = drafts[id]; setSaving(id);
    try {
      await api(`/api/super-admin/plans/${id}`, { method: "PATCH", json: { limits: { users: Number(d.users), projects: Number(d.projects), clients: Number(d.clients), storageMB: Number(d.storageMB) }, price: Number(d.price), features: d.features.split(",").map((f) => f.trim()).filter(Boolean), ...(isDefault ? { isDefault: true } : {}) } });
      toast.success("Plan saved"); await load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save plan"); } finally { setSaving(null); }
  };
  if (!plans) return <Skeleton className="h-64" />;
  return (
    <>
      <PageHeader title="Plans" description="Limits and prices used by every company. -1 means unlimited. Changes apply immediately to the limit checks." />
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((p) => { const d = drafts[p.id]; if (!d) return null; const set = (k: keyof typeof d, v: string) => setDrafts((x) => ({ ...x, [p.id]: { ...x[p.id], [k]: v } })); return (
          <Card key={p.id}>
            <CardHeader><CardTitle className="flex items-center justify-between">{p.name}{p.isDefault && <Badge variant="primary">Default for new companies</Badge>}</CardTitle><CardDescription>{p.currency} per month</CardDescription></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Field label="Price / month" htmlFor={`pl-price-${p.id}`}><Input id={`pl-price-${p.id}`} type="number" min={0} value={d.price} onChange={(e) => set("price", e.target.value)} /></Field>
              <Field label="Users" htmlFor={`pl-users-${p.id}`}><Input id={`pl-users-${p.id}`} type="number" min={-1} value={d.users} onChange={(e) => set("users", e.target.value)} /></Field>
              <Field label="Projects" htmlFor={`pl-projects-${p.id}`}><Input id={`pl-projects-${p.id}`} type="number" min={-1} value={d.projects} onChange={(e) => set("projects", e.target.value)} /></Field>
              <Field label="Clients" htmlFor={`pl-clients-${p.id}`}><Input id={`pl-clients-${p.id}`} type="number" min={-1} value={d.clients} onChange={(e) => set("clients", e.target.value)} /></Field>
              <Field label="Storage (MB)" htmlFor={`pl-storage-${p.id}`}><Input id={`pl-storage-${p.id}`} type="number" min={-1} value={d.storageMB} onChange={(e) => set("storageMB", e.target.value)} /></Field>
              <Field label="Features (comma separated)" htmlFor={`pl-features-${p.id}`} className="sm:col-span-2"><Input id={`pl-features-${p.id}`} value={d.features} onChange={(e) => set("features", e.target.value)} /></Field>
            </CardContent>
            <CardFooter className="justify-between">
              {!p.isDefault ? <Button variant="ghost" size="sm" onClick={() => save(p.id, true)}>Make default</Button> : <span />}
              <Button size="sm" loading={saving === p.id} onClick={() => save(p.id)}><Save />Save</Button>
            </CardFooter>
          </Card>
        ); })}
      </div>
    </>
  );
}

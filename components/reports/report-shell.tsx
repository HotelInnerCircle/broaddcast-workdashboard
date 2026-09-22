"use client";
import { useCallback, useEffect, useState } from "react";
import { addDays, format, startOfMonth, startOfWeek, subMonths, endOfMonth } from "date-fns";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/empty-state";
import { StatsSkeleton } from "@/components/ui/skeleton";
import { api, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { usePickers } from "@/hooks/usePickers";
import type { TeamOption } from "@/components/employees/types";

export interface Filters { from: string; to: string; userId: string; teamId: string; clientId: string; projectId: string }
const key = (d: Date) => format(d, "yyyy-MM-dd");
export const defaultFilters = (): Filters => ({ from: key(addDays(new Date(), -13)), to: key(new Date()), userId: "", teamId: "", clientId: "", projectId: "" });

export function toQuery(f: Filters) {
  return new URLSearchParams({ from: f.from, to: f.to, ...(f.userId ? { userId: f.userId } : {}), ...(f.teamId ? { teamId: f.teamId } : {}), ...(f.clientId ? { clientId: f.clientId } : {}), ...(f.projectId ? { projectId: f.projectId } : {}) });
}

/**
 * Shared frame for every report page (spec 12.18): one filter row above the charts
 * (date range presets, employee, team, client, project), export buttons, data loading.
 */
export function ReportShell<T>({ title, description, endpoint, show = {}, children }: { title: string; description: string; endpoint: string; show?: Partial<Record<"employee" | "team" | "client" | "project", boolean>>; children: (data: T, filters: Filters) => React.ReactNode }) {
  const me = useAuth();
  const manager = me.role !== "EMPLOYEE";
  const { people, clients, projects } = usePickers({ people: manager && show.employee !== false, clients: show.client !== false, projects: show.project !== false });
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => { if (manager && show.team !== false) api<TeamOption[]>("/api/teams").then(setTeams).catch(() => setTeams([])); }, [manager, show.team]);
  const load = useCallback(async () => {
    setError(null);
    try { setData(await api<T>(`${endpoint}?${toQuery(filters)}`)); }
    catch (e) { setError(e instanceof ClientApiError ? e.message : "Failed to load report"); }
  }, [endpoint, filters]);
  useEffect(() => { void load(); }, [load]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const preset = (p: string) => {
    const now = new Date();
    if (p === "today") set({ from: key(now), to: key(now) });
    else if (p === "week") set({ from: key(startOfWeek(now, { weekStartsOn: 1 })), to: key(now) });
    else if (p === "month") set({ from: key(startOfMonth(now)), to: key(now) });
    else if (p === "last-month") { const m = subMonths(now, 1); set({ from: key(startOfMonth(m)), to: key(endOfMonth(m)) }); }
    else if (p === "30d") set({ from: key(addDays(now, -29)), to: key(now) });
  };

  /** Downloads go through fetch so the session cookie applies and the sandbox-safe blob URL opens in a new tab. */
  const download = async (fmt: "csv" | "xlsx" | "pdf") => {
    setExporting(fmt);
    try {
      const res = await fetch(`${endpoint}?${toQuery(filters)}&format=${fmt}`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? "Export failed");
      const blob = await res.blob();
      const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `report.${fmt}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.success(`${name} downloaded`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Export failed"); } finally { setExporting(null); }
  };

  return (
    <>
      <PageHeader title={title} description={description} actions={
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" loading={exporting === "csv"} onClick={() => download("csv")}><Download />CSV</Button>
          <Button variant="outline" size="sm" loading={exporting === "xlsx"} onClick={() => download("xlsx")}><FileSpreadsheet />Excel</Button>
          <Button variant="outline" size="sm" loading={exporting === "pdf"} onClick={() => download("pdf")}><FileText />PDF</Button>
        </div>
      } />
      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <Field label="From" htmlFor="rp-from"><Input id="rp-from" type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label="To" htmlFor="rp-to"><Input id="rp-to" type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-1 pb-0.5">
            {[["today", "Today"], ["week", "This week"], ["month", "This month"], ["last-month", "Last month"], ["30d", "30 days"]].map(([p, l]) => <Button key={p} variant="ghost" size="sm" onClick={() => preset(p)}>{l}</Button>)}
          </div>
          {manager && show.team !== false && <Field label="Team" htmlFor="rp-team"><NativeSelect id="rp-team" className="w-36" value={filters.teamId} onChange={(e) => set({ teamId: e.target.value, userId: "" })}><option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>}
          {manager && show.employee !== false && <Field label="Employee" htmlFor="rp-user"><NativeSelect id="rp-user" className="w-40" value={filters.userId} onChange={(e) => set({ userId: e.target.value })}><option value="">Everyone</option>{people.filter((p) => !filters.teamId || p.team?.id === filters.teamId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>}
          {show.client !== false && <Field label="Client" htmlFor="rp-client"><NativeSelect id="rp-client" className="w-36" value={filters.clientId} onChange={(e) => set({ clientId: e.target.value, projectId: "" })}><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>}
          {show.project !== false && <Field label="Project" htmlFor="rp-project"><NativeSelect id="rp-project" className="w-44" value={filters.projectId} onChange={(e) => set({ projectId: e.target.value })}><option value="">All projects</option>{projects.filter((p) => !filters.clientId || p.client?.id === filters.clientId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>}
        </CardContent>
      </Card>
      {error ? <ErrorState message={error} onRetry={load} /> : data === null ? <div className="space-y-6"><StatsSkeleton /><Card><CardContent className="h-64" /></Card></div> : children(data, filters)}
    </>
  );
}


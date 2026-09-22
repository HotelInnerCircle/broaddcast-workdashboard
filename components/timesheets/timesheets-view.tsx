"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { Table2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { StatsCard } from "@/components/dashboard/stats-card";
import { api, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { useTimer, formatHMS, formatHM } from "@/hooks/useTimer";
import { usePickers } from "@/hooks/usePickers";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

type View = "daily" | "weekly" | "monthly" | "custom";
interface Entry { id: string; userId: string; user: { id: string; name: string; avatarUrl: string | null } | null; client: { id: string; name: string | null } | null; project: { id: string; name: string | null } | null; task: { id: string; name: string | null } | null; status: string; date: string; start: string; end: string | null; elapsedSeconds: number; durationSeconds: number; autoClosed: boolean; notes: string | null }
interface Payload { entries: Entry[]; totals: { seconds: number; byDay: Record<string, number>; byUser: Record<string, number>; byClient: Record<string, { name: string; seconds: number }>; byProject: Record<string, { name: string; seconds: number }> } }
const key = (d: Date) => format(d, "yyyy-MM-dd");
const time = (d: string | null) => (d ? formatDateTime(d).split(", ")[1] : "-");

export function TimesheetsView() {
  const me = useAuth();
  const t = useTimer();
  const manager = me.role !== "EMPLOYEE";
  const { people, clients, projects } = usePickers({ people: manager, clients: true, projects: true });
  const [view, setView] = useState<View>("weekly");
  const [cursor, setCursor] = useState(new Date());
  const [custom, setCustom] = useState({ from: key(addDays(new Date(), -13)), to: key(new Date()) });
  const [userId, setUserId] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = view === "daily" ? { from: key(cursor), to: key(cursor) }
    : view === "weekly" ? { from: key(startOfWeek(cursor, { weekStartsOn: 1 })), to: key(endOfWeek(cursor, { weekStartsOn: 1 })) }
    : view === "monthly" ? { from: key(startOfMonth(cursor)), to: key(endOfMonth(cursor)) } : custom;

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to, ...(userId ? { userId } : {}), ...(clientId ? { clientId } : {}), ...(projectId ? { projectId } : {}) });
      setData(await api<Payload>(`/api/time-entries?${qs}`));
    } catch (e) { setError(e instanceof ClientApiError ? e.message : "Failed to load timesheet"); }
  }, [range.from, range.to, userId, clientId, projectId]);
  useEffect(() => { void load(); }, [load, t.entry?.status]);

  const step = (dir: 1 | -1) => setCursor((c) => addDays(c, dir * (view === "daily" ? 1 : view === "weekly" ? 7 : 30)));
  const title = view === "daily" ? formatDate(cursor) : `${formatDate(`${range.from}T12:00:00Z`)} - ${formatDate(`${range.to}T12:00:00Z`)}`;
  const topClients = data ? Object.values(data.totals.byClient).sort((a, b) => b.seconds - a.seconds).slice(0, 3) : [];

  return (
    <>
      <PageHeader title="Timesheets" description="Every entry's duration is derived on the server from its segments." actions={
        <div className="inline-flex rounded-full bg-muted p-1">
          {(["daily", "weekly", "monthly", "custom"] as View[]).map((v) => <button key={v} onClick={() => setView(v)} className={cn("h-8 rounded-full px-3.5 text-sm capitalize transition-colors", view === v ? "bg-foreground font-medium text-background shadow-sm" : "text-muted-foreground hover:text-foreground")} aria-pressed={view === v}>{v}</button>)}
        </div>
      } />
      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatsCard label="Total tracked" value={formatHM(data.totals.seconds)} hint={`${data.entries.length} entries`} tone="success" />
          <StatsCard label="Days with time" value={Object.keys(data.totals.byDay).length} tone="info" />
          <StatsCard label="Top client" value={topClients[0]?.name ?? "-"} hint={topClients[0] ? formatHM(topClients[0].seconds) : undefined} />
          <StatsCard label="People" value={Object.keys(data.totals.byUser).length} tone="muted" />
        </div>
      )}
      <Card>
        <CardHeader className="flex-row flex-wrap items-end gap-3">
          {view === "custom" ? (
            <><Field label="From" htmlFor="ts-from"><Input id="ts-from" type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} /></Field><Field label="To" htmlFor="ts-to"><Input id="ts-to" type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} /></Field></>
          ) : (
            <div className="flex items-center gap-1 pb-0.5"><Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft /></Button><Button variant="outline" size="icon" onClick={() => step(1)} aria-label="Next"><ChevronRight /></Button><Button variant="ghost" size="sm" onClick={() => setCursor(new Date())}>Today</Button><span className="ml-2 text-sm font-medium">{title}</span></div>
          )}
          {manager && <Field label="Employee" htmlFor="ts-user"><NativeSelect id="ts-user" className="w-40" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>}
          <Field label="Client" htmlFor="ts-client"><NativeSelect id="ts-client" className="w-40" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
          <Field label="Project" htmlFor="ts-project"><NativeSelect id="ts-project" className="w-44" value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">All projects</option>{projects.filter((p) => !clientId || p.client?.id === clientId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          {error ? <ErrorState message={error} onRetry={load} /> : !data ? <TableSkeleton rows={8} cols={8} /> : data.entries.length === 0 ? <EmptyState icon={Table2} title="No time entries" description="Nothing tracked in this range." /> : (
            <Table>
              <THead><TR><TH>Date</TH>{manager && <TH>Employee</TH>}<TH>Client</TH><TH>Project</TH><TH>Task / notes</TH><TH>Start</TH><TH>End</TH><TH className="text-right">Duration</TH><TH>Status</TH></TR></THead>
              <TBody>
                {data.entries.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap">{formatDate(`${e.date}T12:00:00Z`)}</TD>
                    {manager && <TD><span className="inline-flex items-center gap-2">{e.user && <Avatar name={e.user.name} src={e.user.avatarUrl} size="sm" />}{e.user?.name}</span></TD>}
                    <TD className="text-muted-foreground">{e.client?.name}</TD>
                    <TD className="text-muted-foreground">{e.project?.name ? <Link href={`/projects/${e.project.id}`} className="hover:underline">{e.project.name}</Link> : "-"}</TD>
                    <TD>{e.task?.id ? <Link href={`/tasks/${e.task.id}`} className="font-medium hover:text-primary hover:underline">{e.task.name}</Link> : <span className="text-muted-foreground">-</span>}{e.notes ? <p className="max-w-64 truncate text-xs text-muted-foreground" title={e.notes}>{e.notes}</p> : e.autoClosed ? <p className="text-xs text-danger">No notes (auto-closed)</p> : null}</TD>
                    <TD className="whitespace-nowrap">{time(e.start)}</TD>
                    <TD className="whitespace-nowrap">{time(e.end)}{e.autoClosed && <span className="ml-1 text-[10px] font-semibold uppercase text-danger">auto</span>}</TD>
                    <TD className="text-right font-mono tabular-nums">{formatHMS(e.status === "COMPLETED" ? e.durationSeconds : e.id === t.entry?.id ? t.elapsed : e.elapsedSeconds)}</TD>
                    <TD><Badge variant={e.status === "RUNNING" ? "success" : e.status === "PAUSED" ? "warning" : "outline"}>{e.status.toLowerCase()}</Badge></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {data && data.entries.length > 0 && <div className="flex justify-end border-t border-border px-5 py-3 text-sm"><span className="text-muted-foreground">Total&nbsp;</span><span className="font-semibold tabular-nums">{formatHMS(data.totals.seconds)}</span></div>}
        </CardContent>
      </Card>
    </>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { addDays, format } from "date-fns";
import { ChevronLeft, ChevronRight, FileText, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatsCard } from "@/components/dashboard/stats-card";
import { api, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, formatDateTime, formatDuration, relativeTime } from "@/lib/utils/dates";
import type { TeamOption } from "@/components/employees/types";

const key = (d: Date) => format(d, "yyyy-MM-dd");
interface Report { id: string; date: string; completed: string; submittedAt: string }
interface DayRow { user: { id: string; name: string; avatarUrl: string | null; team: string | null }; trackedSeconds: number; byClient: { name: string; seconds: number }[]; report: Report | null }
interface DayData { date: string; rows: DayRow[]; submitted: number; total: number }

/** One question (A68): the other four were removed at the owner's request. */
const QUESTIONS: { key: "completed"; label: string; placeholder: string }[] = [
  { key: "completed", label: "What did you complete today?", placeholder: "Shipped the checkout prototype, reviewed Anil's tokens..." },
];

/** Employee form (spec 12.17) with the five questions and a history of past reports. */
export function DailyReportForm() {
  const [date, setDate] = useState(key(new Date()));
  const [form, setForm] = useState<Record<string, string>>({ completed: "" });
  const [history, setHistory] = useState<Report[] | null>(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    try {
      const rows = await api<Report[]>(`/api/daily-reports?from=${key(addDays(new Date(), -30))}&to=${key(new Date())}`);
      setHistory(rows);
      const mine = rows.find((r) => r.date === date);
      setForm(mine ? { completed: mine.completed } : { completed: "" });
    } catch { setHistory([]); }
  }, [date]);
  useEffect(() => { void load(); }, [load]);
  const submit = async () => {
    setSaving(true);
    try { await api("/api/daily-reports", { method: "POST", json: { date, ...form } }); toast.success("Daily report submitted"); void load(); }
    catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not submit"); } finally { setSaving(false); }
  };
  const existing = history?.find((r) => r.date === date);
  return (
    <>
      <PageHeader title="Daily work report" description="One question. Your manager sees it next to your tracked hours." />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between"><div><CardTitle>{existing ? "Update report" : "Submit report"}</CardTitle><CardDescription>{existing ? `Submitted ${relativeTime(existing.submittedAt)}` : "Not submitted yet for this day."}</CardDescription></div><Input type="date" className="w-40" value={date} max={key(new Date())} onChange={(e) => setDate(e.target.value)} /></CardHeader>
          <CardContent className="space-y-4">
            {QUESTIONS.map((q) => <Field key={q.key} label={q.label} htmlFor={`dr-${q.key}`}><Textarea id={`dr-${q.key}`} rows={6} value={form[q.key]} placeholder={q.placeholder} onChange={(e) => setForm((f) => ({ ...f, [q.key]: e.target.value }))} /></Field>)}
            <div className="flex justify-end"><Button loading={saving} onClick={submit}><FileText />{existing ? "Update report" : "Submit report"}</Button></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent reports</CardTitle><CardDescription>Last 30 days</CardDescription></CardHeader>
          <CardContent className="pt-0">
            {history === null ? <Skeleton className="h-32" /> : history.length === 0 ? <p className="text-sm text-muted-foreground">No reports yet.</p> : (
              <ul className="divide-y divide-border text-sm">{history.map((r) => <li key={r.id}><button className="flex w-full items-center justify-between py-2 text-left hover:text-primary" onClick={() => setDate(r.date)}><span>{formatDate(`${r.date}T12:00:00Z`)}</span><CheckCircle2 className="size-4 text-success" /></button></li>)}</ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/** Manager view at /reports/daily (spec 12.17): each employee's report beside tracked hours and per-client split. */
export function DailyReportsManagerView() {
  const me = useAuth();
  const [date, setDate] = useState(key(new Date()));
  const [teamId, setTeamId] = useState("");
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [data, setData] = useState<DayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (me.role !== "TEAM_LEAD") api<TeamOption[]>("/api/teams").then(setTeams).catch(() => setTeams([])); }, [me.role]);
  const load = useCallback(async () => {
    setError(null);
    try { setData(await api<DayData>(`/api/reports/daily?date=${date}${teamId ? `&teamId=${teamId}` : ""}`)); }
    catch (e) { setError(e instanceof ClientApiError ? e.message : "Failed to load"); }
  }, [date, teamId]);
  useEffect(() => { void load(); }, [load]);
  const step = (n: number) => setDate((d) => key(addDays(new Date(`${d}T12:00:00`), n)));
  return (
    <>
      <PageHeader title="Daily reports" description="What everyone completed, next to their tracked time." actions={
        <div className="flex items-center gap-2">
          {teams.length > 0 && <NativeSelect className="w-36" value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect>}
          <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Previous day"><ChevronLeft /></Button>
          <Input type="date" className="w-40" value={date} max={key(new Date())} onChange={(e) => setDate(e.target.value)} />
          <Button variant="outline" size="icon" onClick={() => step(1)} disabled={date >= key(new Date())} aria-label="Next day"><ChevronRight /></Button>
        </div>
      } />
      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Skeleton className="h-64" /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <StatsCard label="Submitted" value={`${data.submitted} / ${data.total}`} icon={FileText} tone={data.submitted === data.total ? "success" : "warning"} />
            <StatsCard label="Tracked" value={formatDuration(data.rows.reduce((s, r) => s + r.trackedSeconds, 0))} tone="info" />
          </div>
          {data.rows.length === 0 ? <Card><EmptyState icon={FileText} title="Nobody in scope" /></Card> : data.rows.map((r) => (
            <Card key={r.user.id}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="flex items-center gap-3"><Avatar name={r.user.name} src={r.user.avatarUrl} /><div><CardTitle>{r.user.name}</CardTitle><CardDescription>{r.user.team ?? ""}{r.report ? ` - submitted ${formatDateTime(r.report.submittedAt).split(", ")[1]}` : " - not submitted"}</CardDescription></div></div>
                <div className="text-right text-sm"><p className="font-semibold tabular-nums">{formatDuration(r.trackedSeconds)}</p><p className="text-xs text-muted-foreground">{r.byClient.map((c) => `${c.name} ${formatDuration(c.seconds)}`).join(" - ") || "no time tracked"}</p></div>
              </CardHeader>
              {r.report && (
                <CardContent className="pt-0 text-sm">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Completed today</p>
                  <p className="mt-1 whitespace-pre-wrap">{r.report.completed || <span className="text-muted-foreground">-</span>}</p>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

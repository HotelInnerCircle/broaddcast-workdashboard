"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExportButtons } from "@/components/reports/export-buttons";
import { useSearchParams } from "next/navigation";
import { addDays, format, startOfMonth, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, FileText, CheckCircle2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { usePickers } from "@/hooks/usePickers";
import { Field } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatsCard } from "@/components/dashboard/stats-card";
import { api, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { dayKey, formatDate, formatDateTime, formatDuration } from "@/lib/utils/dates";
import { RelativeTime } from "@/components/ui/relative-time";
import type { TeamOption } from "@/components/employees/types";

const key = (d: Date) => format(d, "yyyy-MM-dd");
interface Report { id: string; date: string; completed: string; submittedAt: string }
interface DayRow { user: { id: string; name: string; avatarUrl: string | null; team: string | null }; trackedSeconds: number; byClient: { name: string; seconds: number }[]; report: Report | null }
interface DayGroup { date: string; rows: DayRow[]; submitted: number; total: number; isWorkingDay: boolean }
interface RangeData { from: string; to: string; days: DayGroup[]; submitted: number; total: number; trackedSeconds: number; people: number }
export interface DailyFilters { from: string; to: string; userId: string; teamId: string; status: "" | "submitted" | "missing" }

/** One question (A68): the other four were removed at the owner's request. */
const QUESTIONS: { key: "completed"; label: string; placeholder: string }[] = [
  { key: "completed", label: "What did you complete today?", placeholder: "Shipped the checkout prototype, reviewed Anil's tokens..." },
];

/**
 * Employee form (spec 12.17, locking added in A77).
 *
 * Today's report can be written and rewritten all day. Once the day is over it is read-only - the
 * server enforces the same rule, so this is a matching UI, not the rule itself. "Today" is the
 * company's timezone day, which is what the server compares against; using the browser's own day
 * would show an editable box to someone in another timezone that the server then refuses.
 */
export function DailyReportForm() {
  const me = useAuth();
  const tz = me.company?.timezone;
  const today = tz ? dayKey(new Date(), tz) : key(new Date());
  const [date, setDate] = useState(today);
  const [form, setForm] = useState<Record<string, string>>({ completed: "" });
  const [history, setHistory] = useState<Report[] | null>(null);
  const [saving, setSaving] = useState(false);
  const locked = date !== today;

  const load = useCallback(async () => {
    try {
      const rows = await api<Report[]>(`/api/daily-reports?from=${key(addDays(new Date(), -30))}&to=${today}`);
      setHistory(rows);
      const mine = rows.find((r) => r.date === date);
      setForm(mine ? { completed: mine.completed } : { completed: "" });
    } catch { setHistory([]); }
  }, [date, today]);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    setSaving(true);
    try {
      await api("/api/daily-reports", { method: "POST", json: { date: today, ...form } });
      toast.success("Daily report submitted");
      void load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not submit"); }
    finally { setSaving(false); }
  };

  const existing = history?.find((r) => r.date === date);
  // Fragments rather than strings, so the timestamp can be a <RelativeTime> and
  // not a value baked in at render time that then disagrees on hydration.
  const lockedNote = existing
    ? <>Locked - submitted <RelativeTime value={existing.submittedAt} />. Reports can only be changed on the day itself.</>
    : <>Locked - nothing was submitted on this day.</>;
  const openNote = existing
    ? <>Submitted <RelativeTime value={existing.submittedAt} />. You can keep editing it until the day ends.</>
    : <>Not submitted yet.</>;

  return (
    <>
      <PageHeader title="Daily work report" description="One question. Your team lead sees it next to your tracked hours." />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                {locked ? <><Lock className="size-4 shrink-0 text-muted-foreground" />{formatDate(date + "T12:00:00Z")}</> : existing ? "Update today's report" : "Submit today's report"}
              </CardTitle>
              <CardDescription>{locked ? lockedNote : openNote}</CardDescription>
            </div>
            {locked && <Button variant="outline" size="sm" onClick={() => setDate(today)}>Back to today</Button>}
          </CardHeader>
          <CardContent className="space-y-4">
            {locked ? (
              <div className="rounded-xl bg-muted p-4 text-sm">
                {existing?.completed
                  ? <p className="whitespace-pre-wrap break-words">{existing.completed}</p>
                  : <p className="text-muted-foreground">No report was submitted for this day.</p>}
              </div>
            ) : (
              <>
                {QUESTIONS.map((q) => (
                  <Field key={q.key} label={q.label} htmlFor={"dr-" + q.key}>
                    <Textarea id={"dr-" + q.key} rows={6} value={form[q.key]} placeholder={q.placeholder} onChange={(e) => setForm((f) => ({ ...f, [q.key]: e.target.value }))} />
                  </Field>
                ))}
                <div className="flex justify-end">
                  <Button loading={saving} onClick={submit} disabled={!form.completed.trim()}><FileText />{existing ? "Update report" : "Submit report"}</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Past work reports</CardTitle><CardDescription>Last 30 days - what you wrote on each</CardDescription></CardHeader>
          <CardContent className="pt-0">
            {history === null ? <Skeleton className="h-32" /> : history.length === 0 ? <p className="text-sm text-muted-foreground">No reports yet.</p> : (
              // A80: the date alone was not much use - what was written that day sits under it.
              // Long entries are clamped here and shown in full when the row is opened.
              <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto text-sm">
                {history.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setDate(r.date)}
                      aria-current={r.date === date ? "true" : undefined}
                      className={"w-full space-y-0.5 py-2.5 text-left " + (r.date === date ? "text-primary" : "hover:text-primary")}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className={r.date === date ? "font-semibold" : "font-medium"}>{formatDate(r.date + "T12:00:00Z")}</span>
                        {r.date === today
                          ? <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="size-4" />Today</span>
                          : <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Locked" />}
                      </span>
                      <span className="block whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground line-clamp-3">
                        {r.completed?.trim() || "No details given"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

/**
 * Manager / team-lead view at /reports/daily (spec 12.17, filters added in A79).
 *
 * One filter row - date range with presets, team, person, submitted/missing - matching the other
 * report pages, then a section per day newest first. The default is today, so the common "who has
 * filed so far" glance is unchanged; widening the range is what lets someone follow one person
 * over a fortnight.
 */
export function DailyReportsManagerView() {
  const me = useAuth();
  // The "X submitted their daily report" notification links to ?date=, which opens that one day.
  const params = useSearchParams();
  const linked = params.get("date");
  const [filters, setFilters] = useState<DailyFilters>(() => ({ from: linked ?? key(new Date()), to: linked ?? key(new Date()), userId: "", teamId: "", status: "" }));
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const { people } = usePickers({ people: true, clients: false, projects: false });
  const [data, setData] = useState<RangeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Changing a filter while one is still loading left the older, slower answer on screen. */
  const request = useRef(0);

  useEffect(() => { if (me.role !== "TEAM_LEAD") api<TeamOption[]>("/api/teams").then(setTeams).catch(() => setTeams([])); }, [me.role]);

  /** The filters on screen, as a query string - shared by the load and the download. */
  const query = useMemo(() => {
    const qs = new URLSearchParams({ from: filters.from, to: filters.to });
    if (filters.userId) qs.set("userId", filters.userId);
    if (filters.teamId) qs.set("teamId", filters.teamId);
    if (filters.status) qs.set("status", filters.status);
    return qs.toString();
  }, [filters]);

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    const qs = query;
    const mine = ++request.current;
    try {
      const next = await api<RangeData>("/api/reports/daily?" + qs);
      if (request.current === mine) setData(next);
    } catch (e) { if (request.current === mine) setError(e instanceof ClientApiError ? e.message : "Failed to load"); }
  }, [query]);
  useEffect(() => { void load(); }, [load]);

  const set = (patch: Partial<DailyFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const preset = (p: string) => {
    const now = new Date();
    if (p === "today") set({ from: key(now), to: key(now) });
    else if (p === "yesterday") { const y = key(addDays(now, -1)); set({ from: y, to: y }); }
    else if (p === "week") set({ from: key(startOfWeek(now, { weekStartsOn: 1 })), to: key(now) });
    else if (p === "7d") set({ from: key(addDays(now, -6)), to: key(now) });
    else if (p === "month") set({ from: key(startOfMonth(now)), to: key(now) });
    else if (p === "30d") set({ from: key(addDays(now, -29)), to: key(now) });
  };
  const step = (n: number) => set({ from: key(addDays(new Date(filters.from + "T12:00:00"), n)), to: key(addDays(new Date(filters.to + "T12:00:00"), n)) });
  const oneDay = filters.from === filters.to;
  const chosen = people.find((x) => x.id === filters.userId);

  return (
    <>
      <PageHeader
        title="Daily reports"
        description={chosen ? chosen.name + " - what they completed, next to their tracked time." : "What everyone completed, next to their tracked time."}
        actions={
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft /></Button>
            <Button variant="outline" size="icon" onClick={() => step(1)} disabled={filters.to >= key(new Date())} aria-label="Next"><ChevronRight /></Button>
            {/* Downloads exactly what the filters above are showing. */}
            <ExportButtons href={"/api/reports/daily?" + query} disabled={!data} />
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <Field label="From" htmlFor="dr-from"><Input id="dr-from" type="date" max={filters.to} value={filters.from} onChange={(e) => set({ from: e.target.value })} /></Field>
          <Field label="To" htmlFor="dr-to"><Input id="dr-to" type="date" min={filters.from} max={key(new Date())} value={filters.to} onChange={(e) => set({ to: e.target.value })} /></Field>
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 scrollbar-none max-md:w-full">
            {[["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["7d", "7 days"], ["month", "This month"], ["30d", "30 days"]].map(([k2, l]) => (
              <Button key={k2} variant="ghost" size="sm" className="shrink-0 whitespace-nowrap" onClick={() => preset(k2)}>{l}</Button>
            ))}
          </div>
          {me.role !== "TEAM_LEAD" && teams.length > 0 && (
            <Field label="Team" htmlFor="dr-team">
              <NativeSelect id="dr-team" className="w-36" value={filters.teamId} onChange={(e) => set({ teamId: e.target.value, userId: "" })}>
                <option value="">All teams</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </NativeSelect>
            </Field>
          )}
          <Field label="Employee" htmlFor="dr-user">
            <NativeSelect id="dr-user" className="w-44" value={filters.userId} onChange={(e) => set({ userId: e.target.value })}>
              <option value="">Everyone</option>
              {people.filter((x) => !filters.teamId || x.team?.id === filters.teamId).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Status" htmlFor="dr-status">
            <NativeSelect id="dr-status" className="w-36" value={filters.status} onChange={(e) => set({ status: e.target.value as DailyFilters["status"] })}>
              <option value="">All</option><option value="submitted">Submitted</option><option value="missing">Not submitted</option>
            </NativeSelect>
          </Field>
          {(filters.userId || filters.teamId || filters.status || !oneDay) && (
            <Button variant="ghost" size="sm" onClick={() => setFilters({ from: key(new Date()), to: key(new Date()), userId: "", teamId: "", status: "" })}>Clear</Button>
          )}
        </CardContent>
      </Card>

      {error ? <ErrorState message={error} onRetry={load} /> : !data ? <Skeleton className="h-64" /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <StatsCard label={oneDay ? "Submitted" : "Reports filed"} value={data.submitted + " / " + data.total} icon={FileText} tone={data.submitted === data.total ? "success" : "warning"} />
            <StatsCard label="Tracked" value={formatDuration(data.trackedSeconds)} tone="info" />
            <StatsCard label={oneDay ? "People" : "Days"} value={oneDay ? data.people : data.days.length} tone="muted" className="max-lg:hidden" />
          </div>

          {data.days.every((d) => d.rows.length === 0) ? (
            <Card><EmptyState icon={FileText} title="Nothing to show" description="No reports match these filters. Try a wider date range, or clear the filters." /></Card>
          ) : data.days.map((day) => (
            day.rows.length === 0 ? null : (
              <section key={day.date} className="space-y-3">
                {!oneDay && (
                  <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
                    <h2 className="text-sm font-semibold">{formatDate(day.date + "T12:00:00Z")}</h2>
                    <p className="text-xs text-muted-foreground">{day.submitted} of {day.total} submitted{day.isWorkingDay ? "" : " (non-working day)"}</p>
                  </div>
                )}
                {day.rows.map((r) => (
                  <Card key={day.date + r.user.id}>
                    <CardHeader className="flex-row items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={r.user.name} src={r.user.avatarUrl} />
                        <div>
                          <CardTitle>{r.user.name}</CardTitle>
                          <CardDescription>{r.user.team ?? ""}{r.report ? " - submitted " + formatDateTime(r.report.submittedAt).split(", ")[1] : " - not submitted"}</CardDescription>
                        </div>
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-semibold tabular-nums">{formatDuration(r.trackedSeconds)}</p>
                        <p className="text-xs text-muted-foreground">{r.byClient.map((c) => c.name + " " + formatDuration(c.seconds)).join(" - ") || "no time tracked"}</p>
                      </div>
                    </CardHeader>
                    {r.report && (
                      <CardContent className="pt-0 text-sm">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Completed</p>
                        <p className="mt-1 whitespace-pre-wrap break-words">{r.report.completed || <span className="text-muted-foreground">-</span>}</p>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </section>
            )
          ))}
        </div>
      )}
    </>
  );
}

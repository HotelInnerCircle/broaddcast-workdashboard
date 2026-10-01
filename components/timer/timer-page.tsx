"use client";
import { useCallback, useEffect, useState, useMemo } from "react";
import { ProofThumb } from "@/components/ui/proof-thumb";
import { entryHref, entrySubtitle, entryTitle } from "./mini-timer";
import Link from "next/link";
import { Play, Pause, Square, Coffee, Clock, RotateCcw, ChevronDown, Timer as TimerIcon, Fingerprint } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useTimer, formatHMS, formatHM } from "@/hooks/useTimer";
import { useAuth } from "@/hooks/useAuth";
import { usePickers } from "@/hooks/usePickers";
import { api } from "@/lib/api/client";
import { formatDateTime, formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

interface Group {
  key: string;
  title: string;
  entries: Entry[];
  totalSeconds: number;
  firstStart: string;
  lastEnd: string | null;
  running: boolean;
  latest: Entry;
}

interface Entry { id: string; task: { id: string; name: string | null } | null; project: { id: string; name: string | null } | null; client: { id: string; name: string | null } | null; status: string; start: string; end: string | null; elapsedSeconds: number; durationSeconds: number; autoClosed: boolean; notes: string | null;
  /** Whether a picture of the work is attached (A135) - the link is fetched when it is shown. */
  hasProof?: boolean }

export function TimerPage() {
  const t = useTimer();
  const me = useAuth();
  const { clients } = usePickers({ clients: true });
  const [clientId, setClientId] = useState("");
  const [notes, setNotes] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const loadEntries = useCallback(async () => {
    if (!t.summary) return;
    try {
      const r = await api<{ entries: Entry[] }>(`/api/time-entries?from=${t.summary.date}&to=${t.summary.date}&userId=${me.userId}`);
      setEntries(r.entries);
    } catch { setEntries([]); }
  }, [t.summary, me.userId]);
  useEffect(() => { void loadEntries(); }, [loadEntries, t.entry?.id, t.entry?.status]);

  const startNow = async () => {
    if (!clientId || notes.trim().length < 3) return;
    setStarting(true);
    const ok = await t.start(clientId, { notes: notes.trim() });
    setStarting(false);
    if (ok) { setClientId(""); setNotes(""); }
  };

  /**
   * Pick a finished block back up (A86). The same job coming back later is a new block of time,
   * not an extension of the old one - the 11:19-12:02 you already worked stays exactly as it is
   * and a fresh entry starts now, so the timesheet still shows when the work actually happened.
   *
   * If a timer is already running, `t.start` raises the usual switch dialog and asks what was
   * completed on it first; nothing special is needed here.
   */
  const startAgain = async (e: Entry, key: string) => {
    if (!e.client?.id) return;
    setRestarting(key);
    await t.start(e.client.id, {
      notes: e.notes?.trim() || e.task?.name || e.project?.name || e.client.name || "Continued work",
      projectId: e.project?.id,
      taskId: e.task?.id,
    });
    setRestarting(null);
    void loadEntries();
  };

  /**
   * The same job timed twice in a day is one line, not two (A87). The owner asked for the total
   * spent on a thing, which is what a timesheet is read for - the individual blocks are still
   * there underneath, because "when" matters as much as "how long" when anyone questions a day.
   *
   * Grouped by what makes two blocks the same work: the client, the project, the task and the
   * description. A different description is a different job, even on the same task.
   */
  const groups = useMemo<Group[] | null>(() => {
    if (entries === null) return null;
    const by = new Map<string, Group>();
    for (const e of entries) {
      const label = e.notes?.trim() || e.task?.name || e.project?.name || e.client?.name || "Untitled";
      const key = [e.client?.id ?? "", e.project?.id ?? "", e.task?.id ?? "", label.toLowerCase()].join("|");
      // A running timer's total has to tick, so take the live value for the active entry.
      const seconds = e.status === "COMPLETED" ? e.durationSeconds : e.id === t.entry?.id ? t.elapsed : e.elapsedSeconds;
      const g = by.get(key);
      if (!g) {
        by.set(key, { key, title: label, entries: [e], totalSeconds: seconds, firstStart: e.start, lastEnd: e.end, running: e.status !== "COMPLETED", latest: e });
      } else {
        g.entries.push(e);
        g.totalSeconds += seconds;
        if (e.start < g.firstStart) g.firstStart = e.start;
        if (!g.lastEnd || (e.end && e.end > g.lastEnd)) g.lastEnd = e.end;
        if (e.status !== "COMPLETED") g.running = true;
        if (e.start > g.latest.start) g.latest = e;
      }
    }
    return [...by.values()].sort((a, b) => (a.firstStart < b.firstStart ? 1 : -1));
  }, [entries, t.entry?.id, t.elapsed]);

  const att = t.summary?.attendance ?? null;
  const clockedIn = Boolean(att?.clockIn && !att.clockOut);
  const running = t.entry?.status === "RUNNING";

  return (
    <>
      <PageHeader title="Timer" description="Pick the client and say what you are working on. One active timer at a time." />
      {/*
        A140: this page was 664px wide on a 360px phone, and scrolled sideways
        on every one. `min-w-0` is the half of the fix that makes the rest
        possible - a grid item defaults to `min-width: auto` and refuses to
        shrink below its contents, so no amount of wrapping below could take
        effect. Removing it alone does not bring the bug back, though: the
        widths come from the hero together - the clock, the long client name
        and the row of three large buttons - and all three are sized below.

        Two columns from `lg` rather than `xl`: between 1024 and 1280 the page
        was a single column with a 1280px-wide card holding a stopwatch in the
        middle of it.
      */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card className={cn("overflow-hidden", t.break ? "border-warning/40" : running ? "border-success/40" : "")}>
            <CardContent className="p-5 sm:p-8">
              {t.loading ? <Skeleton className="h-48" /> : t.break ? (
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="flex size-16 items-center justify-center rounded-full bg-warning-soft text-warning"><Coffee className="size-8" /></div>
                  <p className="text-sm font-medium text-warning">On break</p>
                  {/* A140: eight monospaced digits at 60px are 290px wide - wider than the inside of a small phone. */}
                  <p className="font-mono text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl">{formatHMS(t.breakElapsed)}</p>
                  {t.entry && <p className="text-sm text-muted-foreground">&ldquo;{entryTitle(t.entry)}&rdquo; is paused at {formatHMS(t.elapsed)}</p>}
                  <Button size="lg" className="w-full sm:w-auto" onClick={() => void t.endBreak()}>End break</Button>
                </div>
              ) : t.entry ? (
                <div className="flex flex-col items-center gap-4 text-center">
                  {/* A long client name and a long note both have to wrap rather than widen the card. */}
                  <div className="w-full break-words text-sm text-muted-foreground">{entrySubtitle(t.entry)}</div>
                  <Link href={entryHref(t.entry)} className="w-full break-words font-display text-xl hover:text-primary hover:underline sm:text-2xl">{entryTitle(t.entry)}</Link>
                  <p className={cn("font-mono text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl lg:text-7xl", running ? "text-success" : "text-muted-foreground")}>{formatHMS(t.elapsed)}</p>
                  <Badge variant={running ? "success" : "warning"}>{running ? "Running" : "Paused"}</Badge>
                  {/*
                    A140: a grid on a phone, a row from `sm`. Three large buttons
                    need about 570px side by side; wrapping them leaves a ragged
                    line, so the one you reach for - pause or resume - takes the
                    full width and the other two share the line below it.
                  */}
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-center">
                    {running
                      ? <Button size="lg" variant="outline" className="col-span-2 sm:col-auto" onClick={() => void t.pause()}><Pause />Pause</Button>
                      : <Button size="lg" className="col-span-2 sm:col-auto" onClick={() => void t.resume()}><Play />Resume</Button>}
                    <Button size="lg" variant="outline" onClick={() => void t.startBreak()}><Coffee />Take a break</Button>
                    <Button size="lg" variant="danger" onClick={() => void t.stop()}><Square />Stop</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center gap-3"><div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><TimerIcon className="size-6" /></div><div className="min-w-0"><p className="font-semibold">Start a timer</p><p className="text-sm text-muted-foreground">Pick the client and write a line about what you are working on.</p></div></div>
                  <div className="grid gap-4 sm:grid-cols-[1fr_1.6fr]">
                    <Field label="1. Client" htmlFor="tm-client"><NativeSelect id="tm-client" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Select client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
                    <Field label="2. What are you working on?" htmlFor="tm-notes" hint="Required - at least 3 characters. You can refine it when you stop."><Textarea id="tm-notes" rows={2} className="min-h-10" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Homepage wireframes and header revisions" maxLength={1000} /></Field>
                  </div>
                  <div className="grid gap-2 sm:flex sm:flex-wrap">
                    <Button size="lg" disabled={!clientId || notes.trim().length < 3} loading={starting} onClick={startNow}><Play />Start timer</Button>
                    <Button size="lg" variant="outline" onClick={() => void t.startBreak()}><Coffee />Take a break</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Today&apos;s entries</CardTitle><CardDescription>{t.summary ? formatDate(`${t.summary.date}T12:00:00Z`) : ""} - one line per job, showing the total time on it. Open a line to see each session.</CardDescription></CardHeader>
            <CardContent className="p-0 pt-0">
              {groups === null ? <div className="p-5"><Skeleton className="h-24" /></div> : groups.length === 0 ? <EmptyState icon={Clock} title="No time tracked yet today" description="Start a timer above to begin." className="py-8" /> : (
                <ul className="divide-y divide-border">
                  {groups.map((g) => {
                    const e = g.latest;
                    const isOpen = open.has(g.key);
                    const href = e.task?.id ? `/tasks/${e.task.id}` : e.project?.id ? `/projects/${e.project.id}` : `/clients/${e.client?.id}`;
                    return (
                      <li key={g.key} className="px-4 py-3 text-sm sm:px-5">
                        {/*
                          A140: one line on a desktop, two on a phone, without a
                          breakpoint deciding it. The title keeps at least half
                          the row; the total and the buttons sit on the right
                          until they no longer fit, and then wrap underneath as
                          a group rather than one at a time.
                        */}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                          <span className={cn("size-2 shrink-0 rounded-full", g.running ? "bg-success" : "bg-muted-foreground/50")} />
                          {/*
                            On the line itself, not only inside the sessions
                            (A135). Most jobs have one session, so a picture
                            tucked behind an expander would almost never be
                            seen - which is the same as not showing it.
                          */}
                          {(g.entries.find((x) => x.hasProof)?.id) && (
                            <ProofThumb
                              entryId={g.entries.find((x) => x.hasProof)!.id}
                              size="sm"
                              label={`${g.title} - ${formatDateTime(g.firstStart).split(", ")[1]}`}
                            />
                          )}
                          <div className="min-w-0 flex-1 basis-[55%]">
                            <Link href={href} className="block truncate font-medium hover:text-primary hover:underline">{g.title}</Link>
                            <p className="truncate text-xs text-muted-foreground">
                              {[e.client?.name, e.project?.name].filter(Boolean).join(" / ")}
                              {" - "}{formatDateTime(g.firstStart).split(", ")[1]}
                              {g.running ? " - running now" : g.lastEnd ? ` to ${formatDateTime(g.lastEnd).split(", ")[1]}` : ""}
                            </p>
                          </div>
                          <div className="ml-auto flex shrink-0 items-center gap-2">
                          <span className="font-mono text-sm tabular-nums">{formatHMS(g.totalSeconds)}</span>
                          {g.entries.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setOpen((o) => { const n = new Set(o); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}
                              aria-expanded={isOpen}
                              className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                            >
                              {g.entries.length} sessions
                              <ChevronDown className={cn("size-3.5 transition-transform", isOpen && "rotate-180")} />
                            </button>
                          )}
                          {!g.running && e.client?.id && (
                            <Button
                              size="sm" variant="outline" className="shrink-0"
                              disabled={restarting === g.key}
                              onClick={() => void startAgain(e, g.key)}
                              title={`Start a new timer for "${g.title}"`}
                            >
                              <RotateCcw className="size-3.5" />
                              <span className="hidden sm:inline">{restarting === g.key ? "Starting..." : "Start again"}</span>
                            </Button>
                          )}
                          </div>
                        </div>

                        {isOpen && (
                          <ul className="mt-2 space-y-1 border-l-2 border-border pl-3 sm:pl-4">
                            {g.entries.map((x) => (
                              <li key={x.id} className="flex items-center gap-2 text-xs text-muted-foreground sm:gap-3">
                                {/*
                                  Their own picture of the work, on their own
                                  screen (A135). It was compulsory to take and
                                  then only visible to whoever read the report -
                                  the person who took it could not see it at
                                  all, which makes the requirement feel like
                                  something done to them rather than a record of
                                  what they did.
                                */}
                                {x.hasProof && (
                                  <ProofThumb entryId={x.id} size="sm" label={`${g.title} - ${formatDateTime(x.start).split(", ")[1]}`} />
                                )}
                                <span className="min-w-0 flex-1 truncate">
                                  {formatDateTime(x.start).split(", ")[1]}{x.end ? ` to ${formatDateTime(x.end).split(", ")[1]}` : " - running"}
                                  {x.autoClosed && " - auto-closed"}
                                </span>
                                <span className="shrink-0 font-mono tabular-nums">{formatHMS(x.status === "COMPLETED" ? x.durationSeconds : x.id === t.entry?.id ? t.elapsed : x.elapsedSeconds)}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/*
          A140: side by side on a tablet, stacked again once they are beside the
          timer. Between 640 and 1024 these two short cards each took the full
          width of the page one under the other.
        */}
        <div className="grid min-w-0 items-start gap-6 sm:grid-cols-2 lg:block lg:space-y-6">
          <Card>
            <CardHeader><CardTitle>Attendance</CardTitle><CardDescription>{att?.clockIn ? `Clocked in at ${formatDateTime(att.clockIn).split(", ")[1]}${att.clockOut ? `, out at ${formatDateTime(att.clockOut).split(", ")[1]}` : ""}` : "You have not clocked in today."}</CardDescription></CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-0">
              {att?.status && <Badge variant={att.status === "Late" ? "warning" : att.status === "Half Day" ? "danger" : "success"}>{att.status}</Badge>}
              {att?.clockOut ? <span className="text-sm text-muted-foreground">Day complete</span> : <Button asChild><Link href="/swipe"><Fingerprint />{clockedIn ? "Swipe off duty" : "Swipe on duty"}</Link></Button>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Daily summary</CardTitle><CardDescription>Work time comes from timers; session time from the first swipe on duty to the last off.</CardDescription></CardHeader>
            <CardContent className="space-y-3 pt-0">
              <Row label="Work time" value={formatHM((t.summary?.workSeconds ?? 0) + (running ? 0 : 0))} tone="text-success" />
              <Row label="Break time" value={formatHM(t.summary?.breakSeconds ?? 0)} tone="text-warning" />
              <Row label="Total session" value={formatHM(t.summary?.sessionSeconds ?? 0)} />
              <div className="border-t border-border pt-3"><Row label="This week" value={formatHM(t.summary?.weekSeconds ?? 0)} /></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{label}</span><span className={cn("font-semibold tabular-nums", tone)}>{value}</span></div>;
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { entryHref, entrySubtitle, entryTitle } from "./mini-timer";
import Link from "next/link";
import { Play, Pause, Square, Coffee, LogIn, LogOut, Clock, Timer as TimerIcon } from "lucide-react";
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

interface Entry { id: string; task: { id: string; name: string | null } | null; project: { id: string; name: string | null } | null; client: { id: string; name: string | null } | null; status: string; start: string; end: string | null; elapsedSeconds: number; durationSeconds: number; autoClosed: boolean; notes: string | null }

export function TimerPage() {
  const t = useTimer();
  const me = useAuth();
  const { clients } = usePickers({ clients: true });
  const [clientId, setClientId] = useState("");
  const [notes, setNotes] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [starting, setStarting] = useState(false);

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

  const att = t.summary?.attendance ?? null;
  const clockedIn = Boolean(att?.clockIn && !att.clockOut);
  const running = t.entry?.status === "RUNNING";

  return (
    <>
      <PageHeader title="Timer" description="Pick the client and say what you are working on. One active timer at a time." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className={cn("overflow-hidden", t.break ? "border-warning/40" : running ? "border-success/40" : "")}>
            <CardContent className="p-6 sm:p-8">
              {t.loading ? <Skeleton className="h-48" /> : t.break ? (
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="flex size-16 items-center justify-center rounded-full bg-warning-soft text-warning"><Coffee className="size-8" /></div>
                  <p className="text-sm font-medium text-warning">On break</p>
                  <p className="font-mono text-6xl font-semibold tabular-nums tracking-tight">{formatHMS(t.breakElapsed)}</p>
                  {t.entry && <p className="text-sm text-muted-foreground">&ldquo;{entryTitle(t.entry)}&rdquo; is paused at {formatHMS(t.elapsed)}</p>}
                  <Button size="lg" onClick={() => void t.endBreak()}>End break</Button>
                </div>
              ) : t.entry ? (
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="text-sm text-muted-foreground">{entrySubtitle(t.entry)}</div>
                  <Link href={entryHref(t.entry)} className="font-display text-2xl hover:text-primary hover:underline">{entryTitle(t.entry)}</Link>
                  <p className={cn("font-mono text-6xl font-semibold tabular-nums tracking-tight sm:text-7xl", running ? "text-success" : "text-muted-foreground")}>{formatHMS(t.elapsed)}</p>
                  <Badge variant={running ? "success" : "warning"}>{running ? "Running" : "Paused"}</Badge>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {running ? <Button size="lg" variant="outline" onClick={() => void t.pause()}><Pause />Pause</Button> : <Button size="lg" onClick={() => void t.resume()}><Play />Resume</Button>}
                    <Button size="lg" variant="outline" onClick={() => void t.startBreak()}><Coffee />Take a break</Button>
                    <Button size="lg" variant="danger" onClick={() => void t.stop()}><Square />Stop</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex items-center gap-3"><div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary"><TimerIcon className="size-6" /></div><div><p className="font-semibold">Start a timer</p><p className="text-sm text-muted-foreground">Pick the client and write a line about what you are working on.</p></div></div>
                  <div className="grid gap-4 sm:grid-cols-[1fr_1.6fr]">
                    <Field label="1. Client" htmlFor="tm-client"><NativeSelect id="tm-client" value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">Select client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
                    <Field label="2. What are you working on?" htmlFor="tm-notes" hint="Required - at least 3 characters. You can refine it when you stop."><Textarea id="tm-notes" rows={2} className="min-h-10" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Homepage wireframes and header revisions" maxLength={1000} /></Field>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="lg" disabled={!clientId || notes.trim().length < 3} loading={starting} onClick={startNow}><Play />Start timer</Button>
                    <Button size="lg" variant="outline" onClick={() => void t.startBreak()}><Coffee />Take a break</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Today&apos;s entries</CardTitle><CardDescription>{t.summary ? formatDate(`${t.summary.date}T12:00:00Z`) : ""} - durations are computed on the server from segment timestamps.</CardDescription></CardHeader>
            <CardContent className="p-0 pt-0">
              {entries === null ? <div className="p-5"><Skeleton className="h-24" /></div> : entries.length === 0 ? <EmptyState icon={Clock} title="No time tracked yet today" description="Start a timer above to begin." className="py-8" /> : (
                <ul className="divide-y divide-border">
                  {entries.map((e) => (
                    <li key={e.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                      <span className={cn("size-2 rounded-full", e.status === "RUNNING" ? "bg-success" : e.status === "PAUSED" ? "bg-warning" : "bg-muted-foreground/50")} />
                      <div className="min-w-0 flex-1"><Link href={e.task?.id ? `/tasks/${e.task.id}` : e.project?.id ? `/projects/${e.project.id}` : `/clients/${e.client?.id}`} className="block truncate font-medium hover:text-primary hover:underline">{e.notes ?? e.task?.name ?? e.project?.name ?? e.client?.name}</Link><p className="truncate text-xs text-muted-foreground">{[e.client?.name, e.project?.name].filter(Boolean).join(" / ")} - {formatDateTime(e.start).split(", ")[1]}{e.end ? ` to ${formatDateTime(e.end).split(", ")[1]}` : ""}{e.autoClosed && " - auto-closed"}</p></div>
                      <span className="font-mono text-sm tabular-nums">{formatHMS(e.status === "COMPLETED" ? e.durationSeconds : e.id === t.entry?.id ? t.elapsed : e.elapsedSeconds)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Attendance</CardTitle><CardDescription>{att?.clockIn ? `Clocked in at ${formatDateTime(att.clockIn).split(", ")[1]}${att.clockOut ? `, out at ${formatDateTime(att.clockOut).split(", ")[1]}` : ""}` : "You have not clocked in today."}</CardDescription></CardHeader>
            <CardContent className="flex items-center justify-between gap-3 pt-0">
              {att?.status && <Badge variant={att.status === "Late" ? "warning" : att.status === "Half Day" ? "danger" : "success"}>{att.status}</Badge>}
              {clockedIn ? <Button variant="outline" onClick={() => void t.clockOut()}><LogOut />Clock out</Button> : att?.clockOut ? <span className="text-sm text-muted-foreground">Day complete</span> : <Button onClick={() => void t.clockIn()}><LogIn />Clock in</Button>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Daily summary</CardTitle><CardDescription>Work time comes from timers; session time from clock-in to clock-out.</CardDescription></CardHeader>
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

"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronLeft, ChevronRight, CalendarDays, Flag, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { api, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils/cn";
import type { CalendarEvent } from "@/components/tasks/types";

type Mode = "month" | "week" | "day";
const key = (d: Date) => format(d, "yyyy-MM-dd");

/** Calendar (spec 12.19): tasks by due date plus project start/deadline milestones. Week starts Monday (spec 14). */
export function CalendarView() {
  const me = useAuth();
  const tz = me.company?.timezone ?? "UTC";
  const [mode, setMode] = useState<Mode>("month");
  // Phones open on the day list; a 7-column month grid is unreadable at 390px (A67).
  useEffect(() => { if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) setMode("day"); }, []);
  const [cursor, setCursor] = useState(() => new Date(formatInTimeZone(new Date(), tz, "yyyy-MM-dd") + "T00:00:00"));
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const today = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");

  const range = useMemo(() => {
    if (mode === "month") return { from: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), to: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) };
    if (mode === "week") return { from: startOfWeek(cursor, { weekStartsOn: 1 }), to: endOfWeek(cursor, { weekStartsOn: 1 }) };
    return { from: cursor, to: cursor };
  }, [mode, cursor]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const from = `${key(range.from)}T00:00:00.000Z`;
      const to = `${key(addDays(range.to, 1))}T23:59:59.999Z`; // one day of slack for timezone offsets; events carry their own tz day key
      setEvents(await api<CalendarEvent[]>(`/api/calendar?from=${from}&to=${to}`));
    } catch (e) { setError(e instanceof ClientApiError ? e.message : "Failed to load calendar"); }
  }, [range]);
  useEffect(() => { void load(); }, [load]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [events]);

  const step = (dir: 1 | -1) => setCursor((c) => (mode === "month" ? addMonths(c, dir) : mode === "week" ? addWeeks(c, dir) : addDays(c, dir)));
  const title = mode === "month" ? format(cursor, "MMMM yyyy") : mode === "week" ? `${format(range.from, "dd MMM")} - ${format(range.to, "dd MMM yyyy")}` : format(cursor, "EEEE, dd MMM yyyy");
  const days: Date[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) days.push(d);

  return (
    <>
      <PageHeader title="Calendar" description="Task due dates, project starts and deadlines." actions={
        <div className="inline-flex rounded-full bg-muted p-1">
          {(["month", "week", "day"] as Mode[]).map((m) => <button key={m} onClick={() => setMode(m)} className={cn("h-8 rounded-full px-3.5 text-sm capitalize transition-colors", mode === m ? "bg-foreground font-medium text-background shadow-sm" : "text-muted-foreground hover:text-foreground")} aria-pressed={mode === m}>{m}</button>)}
        </div>
      } />
      <Card>
        <CardContent className="p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-1"><Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft /></Button><Button variant="outline" size="icon" onClick={() => step(1)} aria-label="Next"><ChevronRight /></Button><Button variant="ghost" size="sm" onClick={() => setCursor(new Date(today + "T00:00:00"))}>Today</Button></div>
            <h2 className="font-semibold">{title}</h2>
            <div className="hidden items-center gap-3 text-xs text-muted-foreground sm:flex"><span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-primary" />Task</span><span className="inline-flex items-center gap-1"><Flag className="size-3 text-danger" />Deadline</span><span className="inline-flex items-center gap-1"><Rocket className="size-3 text-success" />Start</span></div>
          </div>
          {error ? <ErrorState message={error} onRetry={load} /> : events === null ? <Skeleton className="h-96" /> : mode === "day" ? (
            <DayList date={key(cursor)} events={byDay.get(key(cursor)) ?? []} />
          ) : (
            <div className={cn("grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border bg-border", mode === "month" && "max-md:text-[11px]")}>
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="bg-muted px-2 py-1.5 text-center text-xs font-medium text-muted-foreground">{d}</div>)}
              {days.map((d) => {
                const k = key(d);
                const list = byDay.get(k) ?? [];
                const muted = mode === "month" && !isSameMonth(d, cursor);
                return (
                  <div key={k} className={cn("flex flex-col gap-1 bg-card p-1.5", mode === "month" ? "min-h-20 md:min-h-24" : "min-h-40 md:min-h-72", muted && "bg-muted/40 text-muted-foreground")}>
                    <button onClick={() => { setCursor(d); setMode("day"); }} className={cn("self-start rounded-full px-1.5 text-xs", k === today && "bg-primary font-semibold text-primary-foreground")}>{format(d, "d")}</button>
                    {list.slice(0, mode === "month" ? 3 : 20).map((e) => <EventChip key={e.id} event={e} />)}
                    {mode === "month" && list.length > 3 && <button onClick={() => { setCursor(d); setMode("day"); }} className="text-left text-[11px] text-muted-foreground hover:underline">+{list.length - 3} more</button>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function EventChip({ event: e }: { event: CalendarEvent }) {
  const done = e.status === "Completed" || e.status === "Cancelled";
  return (
    <Link href={e.href} title={`${e.title}${e.subtitle ? ` - ${e.subtitle}` : ""}`} className={cn(
      "flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] leading-tight",
      e.kind === "task" && (e.overdue ? "bg-danger-soft text-danger" : done ? "bg-muted text-muted-foreground line-through" : "bg-primary-soft text-primary"),
      e.kind === "deadline" && (e.overdue ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"),
      e.kind === "start" && "bg-success-soft text-success",
    )}>
      {e.kind === "deadline" && <Flag className="size-3 shrink-0" />}{e.kind === "start" && <Rocket className="size-3 shrink-0" />}<span className="truncate">{e.title}</span>
    </Link>
  );
}

function DayList({ date, events }: { date: string; events: CalendarEvent[] }) {
  if (events.length === 0) return <EmptyState icon={CalendarDays} title="Nothing scheduled" description={`No tasks or milestones on ${date}.`} />;
  return (
    <ul className="divide-y divide-border">
      {events.map((e) => (
        <li key={e.id} className="flex items-center gap-3 py-3 text-sm">
          {e.kind === "task" ? <span className={cn("size-2.5 rounded-full", e.overdue ? "bg-danger" : "bg-primary")} /> : e.kind === "deadline" ? <Flag className="size-4 text-danger" /> : <Rocket className="size-4 text-success" />}
          <Link href={e.href} className="flex-1 font-medium hover:text-primary hover:underline">{e.title}</Link>
          <span className="text-xs text-muted-foreground">{e.subtitle}</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{e.status}</span>
        </li>
      ))}
    </ul>
  );
}

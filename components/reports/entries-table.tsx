"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { formatHMS } from "@/hooks/useTimer";
import { cn } from "@/lib/utils/cn";

export interface ReportEntry {
  id: string;
  date: string;
  user: { id?: string; name: string } | null;
  client: { name: string | null } | null;
  project: { name: string | null } | null;
  task: { id: string; name: string | null } | null;
  start: string;
  end: string | null;
  elapsedSeconds: number;
  status: string;
}

const timeOf = (d: string | Date) => formatDateTime(d).split(", ")[1];

interface Group {
  key: string;
  date: string;
  name: string;
  entries: ReportEntry[];
  seconds: number;
  clients: string[];
  firstStart: string;
  lastEnd: string | null;
  running: boolean;
}

/**
 * One line per person per day, opening to the sessions behind it.
 *
 * A busy day is a dozen rows of the same name, which makes the honest question -
 * "how long did this person work today" - something you answer with a calculator.
 * Grouped, that total is the row, and the sessions are still one click away
 * rather than gone: the flat list is what the timesheet shows and what the export
 * contains, so it stays available on the toggle.
 *
 * Grouping is by person *and day*, not by person alone, because the Date column
 * has to keep meaning something over a range.
 */
function group(entries: ReportEntry[]): Group[] {
  const map = new Map<string, Group>();
  for (const e of entries) {
    // Fall back to the name when the id is absent; two people with one name is a
    // smaller problem than every entry collapsing into a single "null" row.
    const who = e.user?.id ?? e.user?.name ?? "unknown";
    const key = `${e.date}|${who}`;
    let g = map.get(key);
    if (!g) {
      g = { key, date: e.date, name: e.user?.name ?? "Unknown", entries: [], seconds: 0, clients: [], firstStart: e.start, lastEnd: e.end, running: false };
      map.set(key, g);
    }
    g.entries.push(e);
    g.seconds += e.elapsedSeconds;
    const client = e.client?.name;
    if (client && !g.clients.includes(client)) g.clients.push(client);
    if (e.start < g.firstStart) g.firstStart = e.start;
    if (!e.end) g.running = true;
    else if (!g.lastEnd || e.end > g.lastEnd) g.lastEnd = e.end;
  }
  // Entries arrive newest first; keep that inside each group too.
  for (const g of map.values()) g.entries.sort((a, b) => b.start.localeCompare(a.start));
  return [...map.values()];
}

export function EntriesTable({ entries, totalSeconds }: { entries: ReportEntry[]; totalSeconds: number }) {
  const [grouped, setGrouped] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const groups = useMemo(() => group(entries.slice(0, 2000)), [entries]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const sessions = (n: number) => `${n} ${n === 1 ? "session" : "sessions"}`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3">
        <p className="text-sm text-muted-foreground">
          {grouped
            ? `${groups.length} ${groups.length === 1 ? "person-day" : "person-days"} across ${entries.length} entries.`
            : `${entries.length} entries - identical to the timesheet for the same filters.`}
        </p>
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="How to list entries">
          {([["Grouped", true], ["All entries", false]] as const).map(([label, value]) => (
            <button
              key={label}
              type="button"
              onClick={() => setGrouped(value)}
              aria-pressed={grouped === value}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                grouped === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Table cards={false} className="table-sticky-1">
        <THead>
          <TR>
            <TH>Date</TH><TH>Employee</TH><TH>Client</TH><TH>Project</TH><TH>Task</TH><TH>Start</TH><TH>End</TH><TH className="text-right">Duration</TH>
          </TR>
        </THead>
        <TBody>
          {grouped
            ? groups.flatMap((g) => {
                const isOpen = open.has(g.key);
                const rows = [
                  <TR key={g.key} className="cursor-pointer" onClick={() => toggle(g.key)}>
                    <TD className="whitespace-nowrap">{formatDate(`${g.date}T12:00:00Z`)}</TD>
                    <TD>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={(e) => { e.stopPropagation(); toggle(g.key); }}
                        className="-ml-1 flex items-center gap-1.5 rounded text-left font-medium hover:underline"
                      >
                        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
                        <span>
                          {g.name}
                          {/* The count belongs with the name it is counting, not under the Project heading. */}
                          <span className="block text-xs font-normal text-muted-foreground">{sessions(g.entries.length)}</span>
                        </span>
                      </button>
                    </TD>
                    <TD className="text-muted-foreground">
                      {g.clients.length === 0 ? "-" : g.clients.length === 1 ? g.clients[0] : `${g.clients.length} clients`}
                    </TD>
                    <TD />
                    <TD />
                    <TD className="whitespace-nowrap">{timeOf(g.firstStart)}</TD>
                    <TD className="whitespace-nowrap">{g.running ? <span className="text-success">Running</span> : g.lastEnd ? timeOf(g.lastEnd) : "-"}</TD>
                    <TD className="text-right font-mono font-semibold tabular-nums">{formatHMS(g.seconds)}</TD>
                  </TR>,
                ];
                if (isOpen) {
                  for (const e of g.entries) {
                    rows.push(
                      <TR key={e.id} className="bg-muted/30 text-[13px]">
                        <TD />
                        <TD />
                        <TD className="text-muted-foreground">{e.client?.name ?? "-"}</TD>
                        <TD className="text-muted-foreground">{e.project?.name ?? ""}</TD>
                        <TD>{e.task?.id ? <Link href={`/tasks/${e.task.id}`} className="hover:underline" onClick={(ev) => ev.stopPropagation()}>{e.task.name}</Link> : e.task?.name}</TD>
                        <TD className="whitespace-nowrap">{timeOf(e.start)}</TD>
                        <TD className="whitespace-nowrap">{e.end ? timeOf(e.end) : "-"}</TD>
                        <TD className="text-right font-mono tabular-nums">{formatHMS(e.elapsedSeconds)}</TD>
                      </TR>,
                    );
                  }
                }
                return rows;
              })
            : entries.slice(0, 300).map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap">{formatDate(`${e.date}T12:00:00Z`)}</TD>
                  <TD>{e.user?.name}</TD>
                  <TD className="text-muted-foreground">{e.client?.name}</TD>
                  <TD className="text-muted-foreground">{e.project?.name}</TD>
                  <TD>{e.task?.id ? <Link href={`/tasks/${e.task.id}`} className="hover:underline">{e.task.name}</Link> : e.task?.name}</TD>
                  <TD className="whitespace-nowrap">{timeOf(e.start)}</TD>
                  <TD className="whitespace-nowrap">{e.end ? timeOf(e.end) : "-"}</TD>
                  <TD className="text-right font-mono tabular-nums">{formatHMS(e.elapsedSeconds)}</TD>
                </TR>
              ))}
        </TBody>
      </Table>

      <div className="flex justify-end border-t border-border px-5 py-3 text-sm">
        <span className="text-muted-foreground">Total&nbsp;</span>
        <span className="font-semibold tabular-nums">{formatHMS(totalSeconds)}</span>
      </div>
    </>
  );
}

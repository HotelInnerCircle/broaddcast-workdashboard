"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { CalendarCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api, ClientApiError } from "@/lib/api/client";
import { DaySheet } from "./day-sheet";

export interface GridDay {
  date: string; weekday: string; kind: string; detail: string | null;
  clockIn: string | null; clockOut: string | null; workSeconds: number;
  payable: boolean; lateByMinutes: number | null; earlyByMinutes: number | null; swipes: number;
}
export interface GridRow {
  userId: string; userName: string; employeeCode: string | null; phone: string | null;
  joinedOn: string; days: GridDay[]; toSettle: number;
  summary: { present: number; absent: number; leave: number; late: number; halfDay: number; payableDays: number; workingDays: number };
}
export interface Grid {
  month: string; dates: { date: string; weekday: string; working: boolean }[]; rows: GridRow[];
}

/**
 * A short code per day, the way an attendance sheet has always been read.
 *
 * Two letters rather than a word because thirty-one of them have to fit across
 * a screen next to a name. The colour carries the same meaning again, so the
 * sheet is readable at a glance and still readable by somebody who cannot tell
 * the colours apart - the letters are not decoration on the colour, they are
 * the primary signal.
 */
const CODES: Record<string, { code: string; tone: string; label: string }> = {
  Present: { code: "P", tone: "bg-tile-success text-tile-success-fg", label: "Present" },
  Late: { code: "LI", tone: "bg-tile-warning text-tile-warning-fg", label: "Late in" },
  "Half Day": { code: "HD", tone: "bg-tile-warning text-tile-warning-fg", label: "Half day" },
  Absent: { code: "A", tone: "bg-tile-danger text-tile-danger-fg", label: "Absent" },
  Leave: { code: "L", tone: "bg-tile-info text-tile-info-fg", label: "Leave" },
  Holiday: { code: "H", tone: "bg-tile-default text-tile-default-fg", label: "Holiday" },
  "Week off": { code: "WO", tone: "bg-tile-muted text-tile-muted-fg", label: "Week off" },
  Upcoming: { code: "·", tone: "bg-muted/40 text-muted-foreground", label: "Still to come" },
  // A dash rather than nothing: an empty cell reads as a bug, and a month
  // before somebody joined is a fact, not a gap in the data.
  "Before joining": { code: "–", tone: "bg-muted/25 text-muted-foreground/50", label: "Before they joined" },
};

const cellOf = (kind: string) => CODES[kind] ?? { code: "?", tone: "bg-muted text-muted-foreground", label: kind };

export function AuthGrid({ canSettle }: { canSettle: boolean }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [grid, setGrid] = useState<Grid | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyUnsettled, setOnlyUnsettled] = useState(false);
  const [open, setOpen] = useState<{ row: GridRow; day: GridDay } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setGrid(await api<Grid>(`/api/attendance/authorise?month=${month}`, { fresh: true })); }
    catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not load the month"); setGrid(null); }
    finally { setLoading(false); }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(
    () => (grid?.rows ?? []).filter((r) => !onlyUnsettled || r.toSettle > 0),
    [grid, onlyUnsettled],
  );
  const waiting = (grid?.rows ?? []).reduce((n, r) => n + r.toSettle, 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label htmlFor="auth-month" className="text-[13px] font-semibold">Month</label>
            <Input id="auth-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
          </div>
          <label className="flex items-center gap-2 pb-2 text-[13px]">
            <input type="checkbox" className="size-4" checked={onlyUnsettled} onChange={(e) => setOnlyUnsettled(e.target.checked)} />
            Only people with something to settle
          </label>
          <div className="flex-1" />
          {waiting > 0 && (
            <p className="pb-2 text-[13px] font-semibold text-danger">
              {waiting} day{waiting === 1 ? "" : "s"} marked absent
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading ? <TableSkeleton rows={6} />
            : !grid || rows.length === 0 ? (
              <EmptyState icon={CalendarCheck} title="Nothing to show"
                description={onlyUnsettled ? "Every day this month has been accounted for." : "No people in your scope for this month."} />
            ) : (
              /*
               * Scrolls sideways with the name column pinned. A month is
               * thirty-one columns and a name is the only thing that makes a
               * row meaningful - losing it while scrolling to the 28th makes
               * the whole screen unusable.
               */
              <div className="overflow-x-auto">
                <table className="w-max border-separate border-spacing-0 text-[12px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-20 bg-card px-3 py-2 text-left font-semibold ring-1 ring-border">Employee</th>
                      {grid.dates.map((d) => (
                        <th key={d.date}
                          className={cn("w-9 px-0 py-1 text-center font-semibold ring-1 ring-border",
                            d.working ? "bg-card" : "bg-muted/60 text-muted-foreground")}>
                          <span className="block leading-tight">{d.date.slice(8)}</span>
                          <span className="block text-[9px] font-normal uppercase opacity-70">{d.weekday.slice(0, 2)}</span>
                        </th>
                      ))}
                      <th className="bg-card px-2 py-2 text-center font-semibold ring-1 ring-border">P</th>
                      <th className="bg-card px-2 py-2 text-center font-semibold ring-1 ring-border">A</th>
                      <th className="bg-card px-2 py-2 text-center font-semibold ring-1 ring-border">L</th>
                      <th className="bg-card px-2 py-2 text-center font-semibold ring-1 ring-border">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.userId}>
                        <th className="sticky left-0 z-10 max-w-56 bg-card px-3 py-1.5 text-left font-normal ring-1 ring-border">
                          <span className="block truncate font-semibold">{r.userName}</span>
                          <span className="block truncate text-[10.5px] text-muted-foreground">{r.employeeCode ?? "No code"}</span>
                        </th>
                        {r.days.map((d) => {
                          const c = cellOf(d.kind);
                          return (
                            <td key={d.date} className="p-0 ring-1 ring-border">
                              <button
                                type="button"
                                onClick={() => setOpen({ row: r, day: d })}
                                title={`${d.date} · ${c.label}${d.detail ? ` · ${d.detail}` : ""}`}
                                className={cn("h-8 w-9 text-center text-[11px] font-bold transition-opacity hover:opacity-70", c.tone)}
                              >
                                {c.code}
                              </button>
                            </td>
                          );
                        })}
                        <td className="bg-card px-2 text-center font-semibold ring-1 ring-border">{r.summary.present + r.summary.late}</td>
                        <td className={cn("px-2 text-center font-semibold ring-1 ring-border", r.summary.absent > 0 ? "bg-tile-danger text-tile-danger-fg" : "bg-card")}>
                          {r.summary.absent}
                        </td>
                        <td className="bg-card px-2 text-center ring-1 ring-border">{r.summary.leave}</td>
                        <td className="bg-card px-2 text-center font-semibold ring-1 ring-border">{r.summary.payableDays}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </CardContent>
      </Card>

      {/* The legend is not optional: the codes mean nothing to somebody's first week. */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(CODES).filter(([, c]) => c.code).map(([kind, c]) => (
          <span key={kind} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px]", c.tone)}>
            <span className="font-bold">{c.code}</span>{c.label}
          </span>
        ))}
      </div>

      {open && (
        <DaySheet
          row={open.row}
          day={open.day}
          canSettle={canSettle}
          onClose={() => setOpen(null)}
          onSettled={() => { setOpen(null); void load(); }}
        />
      )}
    </div>
  );
}

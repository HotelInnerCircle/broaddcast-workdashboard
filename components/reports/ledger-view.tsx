"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { api } from "@/lib/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";
import { DaySwipesSheet } from "./day-swipes-sheet";

interface Day {
  date: string; weekday: string; kind: string; detail: string | null;
  clockIn: string | null; clockOut: string | null; workSeconds: number; payable: boolean;
  lateByMinutes: number | null; earlyByMinutes: number | null; swipes: number;
}
interface Ledger {
  userId: string; userName: string; month: string;
  shiftName: string | null; shiftStart: string; shiftEnd: string;
  joinedOn: string;
  days: Day[];
  summary: {
    workingDays: number; present: number; late: number; halfDay: number; absent: number;
    leave: number; lossOfPay: number; holidays: number; weekOffs: number; payableDays: number; totalHours: number;
  };
}
interface Person { id: string; name: string }

const TONE: Record<string, string> = {
  Present: "bg-success-soft text-tile-success-fg",
  Late: "bg-warning-soft text-tile-warning-fg",
  "Half Day": "bg-warning-soft text-tile-warning-fg",
  Absent: "bg-danger-soft text-tile-danger-fg",
  Leave: "bg-info-soft text-tile-info-fg",
  Holiday: "bg-warning-soft text-tile-warning-fg",
  "Week off": "bg-muted text-muted-foreground",
  Upcoming: "bg-muted/60 text-muted-foreground",
  "Before joining": "bg-muted/60 text-muted-foreground",
};
/** The letter on a calendar cell. Short enough to fit, spelled out in the legend. */
const CODE: Record<string, string> = {
  Present: "P", Late: "LT", "Half Day": "HD", Absent: "A", Leave: "L",
  Holiday: "H", "Week off": "WO", Upcoming: "", "Before joining": "",
};
const clockAt = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-");
const hm = (s: number) => (s > 0 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : "-");
/** Minutes as "1h 05m", or a dash when there is nothing to report. */
const mins = (m: number | null) => (m === null ? "N/A" : m === 0 ? "-" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`);

/** A94: the month a payslip is checked against. A100: as a calendar, a list, and a day you can open. */
export function LedgerView({ canPickPeople, myUserId }: { canPickPeople: boolean; myUserId: string }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [userId, setUserId] = useState(myUserId);
  const [people, setPeople] = useState<Person[]>([]);
  const [data, setData] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [openDay, setOpenDay] = useState<string | null>(null);

  useEffect(() => {
    if (!canPickPeople) return;
    void api<{ data: Person[] } | Person[]>("/api/employees?limit=100")
      .then((r) => setPeople(Array.isArray(r) ? r : r.data))
      .catch(() => setPeople([]));
  }, [canPickPeople]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<Ledger>(`/api/reports/ledger?month=${month}&userId=${userId}`, { fresh: true })); }
    catch { setData(null); } finally { setLoading(false); }
  }, [month, userId]);
  useEffect(() => { void load(); }, [load]);

  /**
   * The month laid out as weeks, padded so the 1st sits under its weekday.
   * Monday first: the working week starts on Monday here, and a calendar that
   * disagrees with the roster is read wrong at a glance.
   */
  const weeks = useMemo(() => {
    if (!data?.days.length) return [];
    const cells: (Day | null)[] = [];
    const first = new Date(`${data.days[0].date}T12:00:00Z`);
    const lead = (first.getUTCDay() + 6) % 7; // 0 = Monday
    for (let i = 0; i < lead; i++) cells.push(null);
    cells.push(...data.days);
    while (cells.length % 7 !== 0) cells.push(null);
    const out: (Day | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [data]);

  const s = data?.summary;
  const stats: Array<[string, string | number, string]> = s ? [
    ["Payable days", s.payableDays, "text-success"],
    ["Present", s.present, ""],
    ["Late", s.late, s.late ? "text-warning" : ""],
    ["Half days", s.halfDay, ""],
    ["Absent", s.absent, s.absent ? "text-danger" : ""],
    ["Leave", s.leave, ""],
    ["Loss of pay", s.lossOfPay, s.lossOfPay ? "text-danger" : ""],
    ["Hours", `${s.totalHours}h`, ""],
  ] : [];

  const openable = (d: Day) => d.swipes > 0 || Boolean(d.clockIn);
  const selected = data?.days.find((d) => d.date === openDay) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[12px] font-semibold">Month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="mt-1 block h-10 rounded-xl bg-card px-3 text-sm outline-none ring-1 ring-border focus:ring-primary" />
        </label>
        {canPickPeople && people.length > 0 && (
          <label className="text-[12px] font-semibold">Employee
            <select value={userId} onChange={(e) => setUserId(e.target.value)}
              className="mt-1 block h-10 min-w-48 rounded-xl bg-card px-3 text-sm outline-none ring-1 ring-border focus:ring-primary">
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        {data?.shiftName && (
          <span className="mb-1 rounded-full bg-muted px-3 py-1 text-[11.5px] font-semibold text-muted-foreground">
            Shift: {data.shiftName} ({data.shiftStart}-{data.shiftEnd})
          </span>
        )}
      </div>

      {/* Calendar or list, the same month either way. */}
      <div className="inline-flex w-full rounded-2xl bg-muted p-1 sm:w-auto" role="group" aria-label="How to show the month">
        {([["Calendar", "calendar"], ["List", "list"]] as const).map(([label, value]) => (
          <button key={value} type="button" onClick={() => setView(value)} aria-pressed={view === value}
            className={cn("flex-1 rounded-xl px-6 py-2 text-sm font-semibold transition-colors sm:flex-none",
              view === value ? "bg-primary text-primary-foreground shadow-card" : "text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>

      {loading ? <Skeleton className="h-96 rounded-2xl" />
        : !data ? <Card><CardContent className="p-0"><EmptyState icon={CalendarDays} title="Nothing to show" description="Pick a month with attendance in it." className="py-10" /></CardContent></Card>
        : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {stats.map(([k, v, tone]) => (
              <div key={k} className="rounded-2xl bg-card p-3 shadow-card ring-1 ring-border/50">
                <p className="truncate text-[11px] text-muted-foreground">{k}</p>
                <p className={cn("font-display text-[24px] leading-tight", tone)}>{v}</p>
              </div>
            ))}
          </div>

          {view === "calendar" ? (
            <Card><CardContent className="p-3 sm:p-5">
              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="pb-1 text-center text-[11px] font-semibold text-muted-foreground">{d}</div>
                ))}
                {weeks.flat().map((d, i) => d === null ? <div key={`pad-${i}`} /> : (
                  <button
                    key={d.date}
                    type="button"
                    disabled={!openable(d)}
                    onClick={() => setOpenDay(d.date)}
                    aria-label={`${d.date}, ${d.kind}${openable(d) ? " - open the day" : ""}`}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-xl bg-muted/40 px-1 py-2 ring-1 ring-border/50 transition-colors",
                      openable(d) ? "cursor-pointer hover:ring-primary" : "cursor-default",
                    )}
                  >
                    <span className="text-[13px] font-semibold tabular-nums">{Number(d.date.slice(8))}</span>
                    {CODE[d.kind] ? (
                      <span className={cn("w-full rounded-md py-0.5 text-[10.5px] font-bold", TONE[d.kind] ?? "bg-muted")}>{CODE[d.kind]}</span>
                    ) : <span className="py-0.5 text-[10.5px] text-muted-foreground">-</span>}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
                {[["P", "Present"], ["LT", "Late"], ["HD", "Half day"], ["A", "Absent"], ["L", "Leave"], ["H", "Holiday"], ["WO", "Week off"]].map(([code, label]) => (
                  <span key={code} className="inline-flex items-center gap-1.5">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", TONE[label === "Late" ? "Late" : label === "Half day" ? "Half Day" : label === "Week off" ? "Week off" : label] ?? "bg-muted")}>{code}</span>
                    {label}
                  </span>
                ))}
              </div>
            </CardContent></Card>
          ) : (
            <div className="space-y-2">
              {data.days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  disabled={!openable(d)}
                  onClick={() => setOpenDay(d.date)}
                  aria-label={`${d.date}, ${d.kind}${d.swipes ? `, ${d.swipes} swipes` : ""}${openable(d) ? " - open the day" : ""}`}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left shadow-card ring-1 ring-border/50 transition-colors",
                    openable(d) && "hover:ring-primary",
                    !d.payable && d.kind !== "Upcoming" && d.kind !== "Before joining" && "bg-danger-soft/25",
                  )}
                >
                  <span className={cn("w-11 shrink-0 rounded-lg py-1.5 text-center text-[11px] font-bold", TONE[d.kind] ?? "bg-muted")}>
                    {CODE[d.kind] || "-"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[13px]">
                      <span>In: <span className="font-semibold tabular-nums">{clockAt(d.clockIn)}</span></span>
                      <span>Out: <span className="font-semibold tabular-nums">{clockAt(d.clockOut)}</span></span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-muted-foreground">
                      <span>Late in: {mins(d.lateByMinutes)}</span>
                      <span>Early out: {mins(d.earlyByMinutes)}</span>
                      {d.workSeconds > 0 && <span>Worked: {hm(d.workSeconds)}</span>}
                      {d.detail && <span className="truncate">{d.detail}</span>}
                      {d.swipes > 0 && <span className="font-medium text-primary">{d.swipes} {d.swipes === 1 ? "swipe" : "swipes"}</span>}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-display text-[22px] leading-none">{Number(d.date.slice(8))}</p>
                    <p className="text-[11px] text-muted-foreground">{d.weekday}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          <p className="px-1 text-[11.5px] leading-relaxed text-muted-foreground">
            A day is payable unless it was Loss of Pay or an absence with nothing behind it. Holidays
            and week-offs are payable - nobody is docked for a Sunday. Payslips are worked out from
            these same numbers rather than counted again. Late in and early out are measured against
            the shift shown above.
          </p>
        </>
      )}

      {selected && data && (
        <DaySwipesSheet userId={data.userId} userName={data.userName} date={selected.date} onClose={() => setOpenDay(null)} />
      )}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { api } from "@/lib/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";

interface Day {
  date: string; weekday: string; kind: string; detail: string | null;
  clockIn: string | null; clockOut: string | null; workSeconds: number; payable: boolean;
}
interface Ledger {
  userId: string; userName: string; month: string; shiftName: string | null;
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
  Holiday: "bg-muted text-muted-foreground",
  "Week off": "bg-muted text-muted-foreground",
  Upcoming: "bg-muted/60 text-muted-foreground",
  "Before joining": "bg-muted/60 text-muted-foreground",
};
const clockAt = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-");
const hm = (s: number) => (s > 0 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : "-");

/** A94: the month a payslip is checked against. */
export function LedgerView({ canPickPeople, myUserId }: { canPickPeople: boolean; myUserId: string }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [userId, setUserId] = useState(myUserId);
  const [people, setPeople] = useState<Person[]>([]);
  const [data, setData] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);

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
        {data?.shiftName && <span className="mb-1 rounded-full bg-muted px-3 py-1 text-[11.5px] font-semibold text-muted-foreground">Shift: {data.shiftName}</span>}
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

          <Card><CardContent className="p-0">
            <ul className="divide-y divide-border">
              {data.days.map((d) => (
                <li key={d.date} className={cn("flex items-center gap-3 px-4 py-2.5 text-sm", !d.payable && d.kind !== "Upcoming" && d.kind !== "Before joining" && "bg-danger-soft/30")}>
                  <div className="w-14 shrink-0">
                    <p className="font-mono text-[13px] tabular-nums">{d.date.slice(8)}</p>
                    <p className="text-[10.5px] text-muted-foreground">{d.weekday}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold", TONE[d.kind] ?? "bg-muted")}>{d.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">{d.detail ?? ""}</span>
                  <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:block">{clockAt(d.clockIn)} - {clockAt(d.clockOut)}</span>
                  <span className="w-16 shrink-0 text-right font-mono text-[12px] tabular-nums">{hm(d.workSeconds)}</span>
                </li>
              ))}
            </ul>
          </CardContent></Card>

          <p className="px-1 text-[11.5px] leading-relaxed text-muted-foreground">
            A day is payable unless it was Loss of Pay or an absence with nothing behind it. Holidays
            and week-offs are payable - nobody is docked for a Sunday. Payslips are worked out from
            these same numbers rather than counted again.
          </p>
        </>
      )}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { addDays, format, startOfMonth, startOfWeek } from "date-fns";
import { CalendarCheck, LogIn, LogOut, AlertTriangle, CheckCircle2, Plane } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { StatsCard } from "@/components/dashboard/stats-card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { useTimer, formatHM } from "@/hooks/useTimer";
import { usePickers } from "@/hooks/usePickers";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

interface Row { id: string; userId: string; user: { id: string; name: string; avatarUrl: string | null } | null; date: string; clockIn: string | null; clockOut: string | null; breakSeconds: number; workSeconds: number; status: string; autoClosed: boolean; reviewed: boolean; note: string | null; virtual: boolean }
interface Payload { rows: Row[]; summary: { present: number; late: number; halfDay: number; absent: number; leave: number; flagged: number }; scheduledSeconds: number }

const STATUS_VARIANT: Record<string, "success" | "warning" | "danger" | "outline" | "info"> = { Present: "success", Late: "warning", "Half Day": "danger", Absent: "outline", Leave: "info" };
const time = (d: string | null) => (d ? formatDateTime(d).split(", ")[1] : "-");
const key = (d: Date) => format(d, "yyyy-MM-dd");

export function AttendanceView() {
  const me = useAuth();
  const t = useTimer();
  const manager = me.role !== "EMPLOYEE";
  const { people } = usePickers({ people: manager });
  const [from, setFrom] = useState(key(startOfMonth(new Date())));
  const [to, setTo] = useState(key(new Date()));
  const [userId, setUserId] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leave, setLeave] = useState<{ open: boolean; userId: string; date: string; note: string }>({ open: false, userId: "", date: key(new Date()), note: "" });

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ from, to, ...(userId ? { userId } : {}), ...(flaggedOnly ? { flagged: "true" } : {}) });
      setData(await api<Payload>(`/api/attendance?${qs}`));
    } catch (e) { setError(e instanceof ClientApiError ? e.message : "Failed to load attendance"); }
  }, [from, to, userId, flaggedOnly]);
  useEffect(() => { void load(); }, [load, t.summary?.attendance?.status, t.summary?.attendance?.clockOut]);

  const review = async (id: string) => { try { await api(`/api/attendance/${id}/review`, { method: "POST" }); toast.success("Marked as reviewed"); void load(); } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Failed"); } };
  const saveLeave = async () => {
    try { await api("/api/attendance/leave", { method: "POST", json: { userId: leave.userId, date: leave.date, note: leave.note || null } }); toast.success("Leave recorded"); setLeave((l) => ({ ...l, open: false })); void load(); }
    catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not set leave"); }
  };
  const preset = (p: "week" | "month" | "7d") => { const now = new Date(); setTo(key(now)); setFrom(key(p === "week" ? startOfWeek(now, { weekStartsOn: 1 }) : p === "month" ? startOfMonth(now) : addDays(now, -6))); };

  const att = t.summary?.attendance ?? null;
  const clockedIn = Boolean(att?.clockIn && !att.clockOut);

  return (
    <>
      <PageHeader title="Attendance" description={manager ? "Clock-in/out records for your scope. Auto-closed records are flagged for review." : "Your clock-in and clock-out history."} actions={
        <div className="flex items-center gap-2">
          {manager && <Button variant="outline" onClick={() => setLeave({ open: true, userId: people[0]?.id ?? "", date: key(new Date()), note: "" })}><Plane />Mark leave</Button>}
          {clockedIn ? <Button variant="outline" onClick={() => void t.clockOut()}><LogOut />Clock out</Button> : att?.clockOut ? null : <Button onClick={() => void t.clockIn()}><LogIn />Clock in</Button>}
        </div>
      } />
      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3 xl:grid-cols-6">
          <StatsCard label="Present" value={data.summary.present} tone="success" />
          <StatsCard label="Late" value={data.summary.late} tone="warning" />
          <StatsCard label="Half day" value={data.summary.halfDay} tone="danger" />
          <StatsCard label="Absent" value={data.summary.absent} tone="muted" />
          <StatsCard label="Leave" value={data.summary.leave} tone="info" />
          <StatsCard label="Needs review" value={data.summary.flagged} icon={AlertTriangle} tone={data.summary.flagged > 0 ? "danger" : "muted"} />
        </div>
      )}
      <Card>
        <CardHeader className="flex-row flex-wrap items-end gap-3">
          <Field label="From" htmlFor="at-from"><Input id="at-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To" htmlFor="at-to"><Input id="at-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="flex gap-1 pb-0.5"><Button variant="ghost" size="sm" onClick={() => preset("week")}>This week</Button><Button variant="ghost" size="sm" onClick={() => preset("month")}>This month</Button><Button variant="ghost" size="sm" onClick={() => preset("7d")}>Last 7 days</Button></div>
          {manager && <Field label="Employee" htmlFor="at-user"><NativeSelect id="at-user" className="w-44" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Everyone</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>}
          {manager && <label className="inline-flex items-center gap-2 pb-2.5 text-sm text-muted-foreground"><input type="checkbox" className="accent-primary" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />Flagged only</label>}
        </CardHeader>
        <CardContent className="p-0 pt-0">
          {error ? <ErrorState message={error} onRetry={load} /> : !data ? <TableSkeleton rows={6} cols={7} /> : data.rows.length === 0 ? <EmptyState icon={CalendarCheck} title="No attendance records" description="Nothing recorded in this range." /> : (
            <Table>
              <THead><TR>{manager && <TH>Employee</TH>}<TH>Date</TH><TH>Clock in</TH><TH>Clock out</TH><TH>Break</TH><TH>Total hours</TH><TH>Status</TH>{manager && <TH className="text-right">Review</TH>}</TR></THead>
              <TBody>
                {data.rows.map((r) => (
                  <TR key={r.id} className={cn(r.autoClosed && !r.reviewed && "bg-danger-soft/40 hover:bg-danger-soft/60", r.virtual && "opacity-70")}>
                    {manager && <TD><span className="inline-flex items-center gap-2">{r.user && <Avatar name={r.user.name} src={r.user.avatarUrl} size="sm" />}{r.user?.name}</span></TD>}
                    <TD className="whitespace-nowrap">{formatDate(`${r.date}T12:00:00Z`)}</TD>
                    <TD className="whitespace-nowrap">{time(r.clockIn)}</TD>
                    <TD className="whitespace-nowrap">{time(r.clockOut)}{r.autoClosed && <span className="ml-1 text-[10px] font-semibold uppercase text-danger" title="Forgotten clock-out closed automatically at end of day + 2h">auto</span>}</TD>
                    <TD>{r.breakSeconds ? formatHM(r.breakSeconds) : "-"}</TD>
                    <TD className="font-medium tabular-nums">{r.workSeconds ? formatHM(r.workSeconds) : r.clockIn && !r.clockOut ? <span className="text-success">in progress</span> : "-"}</TD>
                    <TD><Badge variant={STATUS_VARIANT[r.status] ?? "default"}>{r.status}</Badge>{r.note && <p className="mt-0.5 max-w-40 truncate text-xs text-muted-foreground">{r.note}</p>}</TD>
                    {manager && <TD className="text-right">{r.autoClosed && !r.reviewed ? <Button size="sm" variant="outline" onClick={() => review(r.id)}><CheckCircle2 />Reviewed</Button> : r.autoClosed ? <span className="text-xs text-muted-foreground">reviewed</span> : null}</TD>}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <Dialog open={leave.open} onOpenChange={(o) => !o && setLeave((l) => ({ ...l, open: false }))}>
        <DialogContent title="Mark leave" description="Leave is set manually; there is no request workflow in this version.">
          <div className="space-y-4">
            <Field label="Employee" htmlFor="lv-user"><NativeSelect id="lv-user" value={leave.userId} onChange={(e) => setLeave((l) => ({ ...l, userId: e.target.value }))}>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect></Field>
            <Field label="Date" htmlFor="lv-date"><Input id="lv-date" type="date" value={leave.date} onChange={(e) => setLeave((l) => ({ ...l, date: e.target.value }))} /></Field>
            <Field label="Note" htmlFor="lv-note"><Input id="lv-note" value={leave.note} onChange={(e) => setLeave((l) => ({ ...l, note: e.target.value }))} placeholder="Optional" /></Field>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setLeave((l) => ({ ...l, open: false }))}>Cancel</Button><Button onClick={saveLeave} disabled={!leave.userId || !leave.date}>Save leave</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

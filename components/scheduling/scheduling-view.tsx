"use client";
import { useEffect, useState } from "react";
import { CalendarOff, Clock, Moon, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { api, ClientApiError } from "@/lib/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils/cn";
import { WEEKDAYS } from "@/types";

export interface Shift {
  id: string; name: string; startTime: string; endTime: string; workingDays: string[];
  lateThresholdMinutes: number; active: boolean; people: number; overnight: boolean;
}
export interface Holiday { id: string; date: string; name: string }
export interface Policy { type: string; typeLabel: string; year: number; daysPerYear: number; monthlyAccrual: boolean }

const DAY_LABEL: Record<string, string> = { mon: "M", tue: "T", wed: "W", thu: "T", fri: "F", sat: "S", sun: "S" };
const BLANK = { name: "", startTime: "09:00", endTime: "18:00", lateThresholdMinutes: "10" };

/** Shifts and holidays (A90). HR sets the hours people are actually judged against. */
export function SchedulingView() {
  const [tab, setTab] = useState("shifts");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [form, setForm] = useState(BLANK);
  const [days, setDays] = useState<string[]>(["mon", "tue", "wed", "thu", "fri"]);
  const [hol, setHol] = useState({ date: "", name: "" });
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    void api<Shift[]>("/api/shifts", { fresh: true }).then(setShifts).catch(() => setShifts([]));
    void api<Holiday[]>("/api/holidays", { fresh: true }).then(setHolidays).catch(() => setHolidays([]));
    void api<Policy[]>("/api/leave/policies", { fresh: true }).then(setPolicies).catch(() => setPolicies([]));
  };
  useEffect(load, []);

  const addShift = async () => {
    setBusy(true);
    try {
      await api("/api/shifts", { method: "POST", json: {
        name: form.name.trim(), startTime: form.startTime, endTime: form.endTime,
        workingDays: days, lateThresholdMinutes: Number(form.lateThresholdMinutes),
      } });
      setForm(BLANK); setDays(["mon", "tue", "wed", "thu", "fri"]); load();
      toast.success("Shift added");
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not add the shift"); }
    finally { setBusy(false); }
  };

  const removeShift = async (s: Shift) => {
    try {
      const r = await api<{ moved: number }>(`/api/shifts/${s.id}`, { method: "DELETE" });
      load();
      toast.success(r.moved > 0 ? `${s.name} removed - ${r.moved} person(s) back on the company hours` : `${s.name} removed`);
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not remove the shift"); }
  };

  const addHoliday = async () => {
    setBusy(true);
    try {
      await api("/api/holidays", { method: "POST", json: { date: hol.date, name: hol.name.trim() } });
      setHol({ date: "", name: "" }); load();
      toast.success("Holiday added");
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not add the holiday"); }
    finally { setBusy(false); }
  };

  const removeHoliday = async (h: Holiday) => {
    try { await api(`/api/holidays/${h.id}`, { method: "DELETE" }); load(); toast.success(`${h.name} removed`); }
    catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not remove it"); }
  };

  const savePolicy = async (type: string, daysPerYear: number) => {
    try {
      const next = await api<Policy[]>("/api/leave/policies", { method: "PUT", json: { type, year: new Date().getFullYear(), daysPerYear } });
      setPolicies(next);
      toast.success("Allowance saved");
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save it"); }
  };

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="shifts">Shifts</TabsTrigger>
          <TabsTrigger value="holidays">Holidays</TabsTrigger>
          <TabsTrigger value="leave">Leave allowance</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "shifts" ? <Shifts rows={shifts} form={form} setForm={setForm} days={days} setDays={setDays} busy={busy} onAdd={addShift} onRemove={removeShift} />
        : tab === "holidays" ? <Holidays rows={holidays} hol={hol} setHol={setHol} busy={busy} onAdd={addHoliday} onRemove={removeHoliday} />
        : <Allowances rows={policies} onSave={savePolicy} />}
    </div>
  );
}

function DayDots({ on }: { on: string[] }) {
  return (
    <div className="mt-1.5 flex gap-1">
      {WEEKDAYS.map((d) => (
        <span key={d} className={cn("flex size-5 items-center justify-center rounded-full text-[10px] font-bold",
          on.includes(d) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{DAY_LABEL[d]}</span>
      ))}
    </div>
  );
}

function Shifts({ rows, form, setForm, days, setDays, busy, onAdd, onRemove }: {
  rows: Shift[]; form: typeof BLANK; setForm: (f: typeof BLANK) => void;
  days: string[]; setDays: (f: (x: string[]) => string[]) => void;
  busy: boolean; onAdd: () => Promise<void>; onRemove: (s: Shift) => Promise<void>;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardContent className="p-0">
        {rows.length === 0 ? (
          <EmptyState icon={Clock} title="No shifts yet" description="Everyone is on the company hours from Settings. Add a shift to give people their own timings." className="py-10" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-semibold">
                    {s.name}
                    {s.overnight && <span className="flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-bold text-tile-info-fg"><Moon className="size-3" />overnight</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.startTime} - {s.endTime} &middot; {s.lateThresholdMinutes} min grace &middot; <Users className="inline size-3" /> {s.people}
                  </p>
                  <DayDots on={s.workingDays} />
                </div>
                <button type="button" onClick={() => void onRemove(s)} aria-label={`Remove ${s.name}`} className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-danger-soft hover:text-danger">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-5">
        <p className="text-sm font-semibold">Add a shift</p>
        <div><Label htmlFor="sh-name">Name</Label><Input id="sh-name" value={form.name} placeholder="General" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label htmlFor="sh-start">Starts</Label><Input id="sh-start" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} /></div>
          <div><Label htmlFor="sh-end">Ends</Label><Input id="sh-end" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} /></div>
        </div>
        {form.endTime <= form.startTime && <p className="text-[11.5px] font-medium text-tile-info-fg">Ends before it starts, so this is an overnight shift.</p>}
        <div>
          <Label>Working days</Label>
          <div className="mt-1 flex gap-1.5">
            {WEEKDAYS.map((d) => (
              <button key={d} type="button" aria-pressed={days.includes(d)}
                onClick={() => setDays((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d])}
                className={cn("size-9 rounded-full text-[11px] font-bold", days.includes(d) ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                {DAY_LABEL[d]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="sh-grace">Lateness allowed (minutes)</Label>
          <Input id="sh-grace" inputMode="numeric" value={form.lateThresholdMinutes} onChange={(e) => setForm({ ...form, lateThresholdMinutes: e.target.value })} />
        </div>
        <Button className="w-full" onClick={() => void onAdd()} disabled={busy || form.name.trim().length < 2 || days.length === 0}>
          <Plus className="size-4" />Add shift
        </Button>
      </CardContent></Card>
    </div>
  );
}

function Holidays({ rows, hol, setHol, busy, onAdd, onRemove }: {
  rows: Holiday[]; hol: { date: string; name: string }; setHol: (h: { date: string; name: string }) => void;
  busy: boolean; onAdd: () => Promise<void>; onRemove: (h: Holiday) => Promise<void>;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2"><CardContent className="p-0">
        {rows.length === 0 ? (
          <EmptyState icon={CalendarOff} title="No holidays yet" description="Add the days the company does not work. Nobody is marked absent on a holiday." className="py-10" />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-5 py-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-warning-soft text-tile-warning-fg"><CalendarOff className="size-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{h.name}</p>
                  <p className="text-xs text-muted-foreground">{new Date(`${h.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                </div>
                <button type="button" onClick={() => void onRemove(h)} aria-label={`Remove ${h.name}`} className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-danger-soft hover:text-danger">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-5">
        <p className="text-sm font-semibold">Add a holiday</p>
        <div><Label htmlFor="ho-date">Date</Label><Input id="ho-date" type="date" value={hol.date} onChange={(e) => setHol({ ...hol, date: e.target.value })} /></div>
        <div><Label htmlFor="ho-name">Name</Label><Input id="ho-name" value={hol.name} placeholder="Diwali" onChange={(e) => setHol({ ...hol, name: e.target.value })} /></div>
        <Button className="w-full" onClick={() => void onAdd()} disabled={busy || !hol.date || hol.name.trim().length < 2}>
          <Plus className="size-4" />Add holiday
        </Button>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          A holiday stops the day counting as a working day, so nobody is marked absent for it and
          it is left out of the hours people are expected to work.
        </p>
      </CardContent></Card>
    </div>
  );
}

/** How many days of each kind people get in a year (A91). Loss of pay and on duty have none. */
function Allowances({ rows, onSave }: { rows: Policy[]; onSave: (type: string, days: number) => Promise<void> }) {
  return (
    <Card><CardContent className="p-0">
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.type} className="flex items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{r.typeLabel}</p>
              <p className="text-xs text-muted-foreground">
                {r.daysPerYear} day(s) a year{r.monthlyAccrual ? ` · ${Math.round((r.daysPerYear / 12) * 10) / 10} a month as the year goes on` : " · all up front"}
              </p>
            </div>
            <Input
              aria-label={`Days per year for ${r.typeLabel}`} defaultValue={String(r.daysPerYear)} inputMode="numeric"
              className="w-24 shrink-0"
              onBlur={(e) => { const n = Number(e.target.value); if (!Number.isNaN(n) && n !== r.daysPerYear) void onSave(r.type, n); }}
            />
          </li>
        ))}
      </ul>
      <p className="px-5 pb-4 text-[11.5px] leading-relaxed text-muted-foreground">
        Earned month by month rather than granted on the first of January, so a balance in September
        shows nine twelfths of the year. Loss of Pay and On Duty are recorded but never deducted.
      </p>
    </CardContent></Card>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { IndianRupee, Pencil, AlertCircle, History } from "lucide-react";
import { api, ClientApiError } from "@/lib/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";

interface Scale { basic: number; hra: number; conveyance: number; lta: number; special: number }
interface Row {
  userId: string; userName: string; employeeCode: string | null; designation: string | null;
  scale: Scale | null; gross: number | null; effectiveFrom: string | null; hasBank: boolean;
}
interface Register { rows: Row[]; withSalary: number; total: number }
interface HistoryRow extends Scale { id: string; effectiveFrom: string; gross: number; note: string | null }

const rs = (n: number | null) => (n === null ? "-" : `₹${n.toLocaleString("en-IN")}`);
const EMPTY: Scale = { basic: 0, hra: 0, conveyance: 0, lta: 0, special: 0 };
const FIELDS: Array<[keyof Scale, string]> = [
  ["basic", "Basic"], ["hra", "HRA"], ["conveyance", "Conveyance"], ["lta", "LTA"], ["special", "Special allowance"],
];

/**
 * What everyone is paid, and setting it.
 *
 * A change is **effective from a date**, and saving one adds a row rather than
 * overwriting the last: a raise in June must not change what May's payslip said.
 * The history below the form is that trail, and it is why a payslip issued two
 * years ago can still be reproduced exactly.
 */
export function SalaryRegister() {
  const [data, setData] = useState<Register | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [scale, setScale] = useState<Scale>(EMPTY);
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 8) + "01");
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<Register>("/api/payroll/salaries", { fresh: true })); }
    catch { setData(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = async (row: Row) => {
    setEditing(row);
    setScale(row.scale ?? EMPTY);
    setNote("");
    setHistory(null);
    try { setHistory(await api<HistoryRow[]>(`/api/payroll/salaries?userId=${row.userId}`, { fresh: true })); }
    catch { setHistory([]); }
  };

  const gross = FIELDS.reduce((n, [k]) => n + (Number(scale[k]) || 0), 0);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api("/api/payroll/salaries", {
        method: "POST",
        json: { userId: editing.userId, effectiveFrom, ...scale, note: note || null },
      });
      toast.success(`${editing.userName}'s salary saved`);
      setEditing(null);
      await load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save"); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      {data && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className={cn("rounded-full px-3 py-1 font-semibold",
            data.withSalary === data.total ? "bg-success-soft text-tile-success-fg" : "bg-warning-soft text-tile-warning-fg")}>
            {data.withSalary} of {data.total} have a salary set
          </span>
          <span className="text-muted-foreground">A payslip cannot be generated for anyone without one.</span>
        </div>
      )}

      {loading ? <Skeleton className="h-96 rounded-2xl" />
        : !data ? <Card><CardContent className="p-0"><EmptyState icon={IndianRupee} title="Nothing to show" className="py-10" /></CardContent></Card>
        : (
        <div className="space-y-2">
          {data.rows.map((row) => (
            <div key={row.userId} className={cn(
              "flex flex-wrap items-center gap-3 rounded-2xl bg-card p-3 shadow-card ring-1 ring-border/50",
              !row.scale && "ring-warning/40",
            )}>
              <Avatar name={row.userName} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{row.userName}</p>
                <p className="truncate text-[11.5px] text-muted-foreground">
                  {[row.employeeCode, row.designation].filter(Boolean).join(" - ") || "No designation"}
                  {row.effectiveFrom && ` - from ${row.effectiveFrom}`}
                </p>
              </div>
              {row.scale ? (
                <div className="text-right">
                  <p className="font-display text-[20px] leading-none">{rs(row.gross)}</p>
                  <p className="text-[10.5px] text-muted-foreground">a month</p>
                </div>
              ) : (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-warning">
                  <AlertCircle className="size-3.5" />No salary set
                </span>
              )}
              <Button variant="outline" size="sm" onClick={() => void open(row)}>
                <Pencil />{row.scale ? "Change" : "Set"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Salary for ${editing.userName}`}>
          <div aria-hidden="true" onClick={() => setEditing(null)} className="absolute inset-0 bg-foreground/40" />
          <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-card shadow-card ring-1 ring-border sm:rounded-3xl">
            <div className="border-b border-border px-5 py-4">
              <p className="font-semibold">{editing.userName}</p>
              <p className="text-[12px] text-muted-foreground">Monthly amounts at full attendance.</p>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
              <label className="block text-[12px] font-semibold">Effective from
                <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="mt-1 block h-10 w-full rounded-xl bg-muted/40 px-3 text-sm outline-none ring-1 ring-border focus:ring-primary" />
                <span className="mt-1 block text-[11px] font-normal text-muted-foreground">
                  Payslips before this date keep the old figures.
                </span>
              </label>
              {FIELDS.map(([key, label]) => (
                <label key={key} className="block text-[12px] font-semibold">{label}
                  <input type="number" min={0} inputMode="numeric" value={scale[key] || ""}
                    onChange={(e) => setScale((s) => ({ ...s, [key]: Number(e.target.value) || 0 }))}
                    className="mt-1 block h-10 w-full rounded-xl bg-muted/40 px-3 text-sm outline-none ring-1 ring-border focus:ring-primary" />
                </label>
              ))}
              <label className="block text-[12px] font-semibold">Why it changed
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Annual revision"
                  className="mt-1 block h-10 w-full rounded-xl bg-muted/40 px-3 text-sm outline-none ring-1 ring-border focus:ring-primary" />
              </label>
              <div className="flex items-center justify-between rounded-xl bg-primary-soft px-4 py-3">
                <span className="text-[12px] font-semibold text-primary">Gross a month</span>
                <span className="font-display text-[22px] text-primary">{rs(gross)}</span>
              </div>

              {history && history.length > 0 && (
                <div className="pt-2">
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                    <History className="size-3.5" />Previous scales
                  </p>
                  <ul className="space-y-1">
                    {history.map((h) => (
                      <li key={h.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-1.5 text-[12px]">
                        <span>{h.effectiveFrom}{h.note ? ` - ${h.note}` : ""}</span>
                        <span className="font-medium tabular-nums">{rs(h.gross)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button loading={saving} onClick={() => void save()} disabled={gross <= 0}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

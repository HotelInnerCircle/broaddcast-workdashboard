"use client";

import { useCallback, useEffect, useState } from "react";
import { IndianRupee, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { api, ClientApiError } from "@/lib/api/client";

interface Scale {
  id: string; effectiveFrom: string; basic: number; hra: number; conveyance: number;
  lta: number; special: number; gross: number; note: string | null;
}

const PARTS = [
  { key: "basic" as const, label: "Basic", required: true, why: "What PF and gratuity are worked out from." },
  { key: "hra" as const, label: "HRA", required: false, why: "House rent allowance." },
  { key: "conveyance" as const, label: "Conveyance", required: false, why: "Travel allowance." },
  { key: "lta" as const, label: "LTA", required: false, why: "Leave travel allowance." },
  { key: "special" as const, label: "Special", required: false, why: "Whatever is left to reach the agreed gross." },
];

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const pretty = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * Somebody's pay, on their own page (A136).
 *
 * It lived only on the salary register - a separate screen listing everybody -
 * so looking up one person's pay meant leaving their record, finding them in a
 * list, and losing everything else about them. Everything else that is true of
 * an employee is on their page; their salary should be too.
 *
 * The same endpoints the register uses, not a second way of writing a salary:
 * a scale set here and a scale set there have to be the same thing, or a
 * payslip computed from one would disagree with the screen showing the other.
 */
export function EmployeeSalary({ userId, userName, canEdit }: { userId: string; userName: string; canEdit: boolean }) {
  const [rows, setRows] = useState<Scale[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    effectiveFrom: new Date().toISOString().slice(0, 10),
    basic: "", hra: "", conveyance: "", lta: "", special: "", note: "",
  });

  const load = useCallback(async () => {
    try { setRows(await api<Scale[]>(`/api/payroll/salaries?userId=${userId}`, { fresh: true })); }
    catch { setRows([]); }
  }, [userId]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/payroll/salaries", {
        method: "POST",
        json: {
          userId,
          effectiveFrom: form.effectiveFrom,
          basic: Number(form.basic || 0),
          hra: Number(form.hra || 0),
          conveyance: Number(form.conveyance || 0),
          lta: Number(form.lta || 0),
          special: Number(form.special || 0),
          note: form.note.trim() || null,
        },
      });
      toast.success(`Salary set for ${userName.split(" ")[0]}`);
      setAdding(false);
      setForm({ ...form, basic: "", hra: "", conveyance: "", lta: "", special: "", note: "" });
      await load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save it"); }
    finally { setBusy(false); }
  };

  const gross = PARTS.reduce((n, p) => n + Number(form[p.key] || 0), 0);
  const current = rows?.[0] ?? null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2"><IndianRupee className="size-4" />Salary</CardTitle>
          <CardDescription>
            {/*
              Said here rather than left to be discovered: a raise is a new row,
              not an edit, and that is what lets a payslip issued last year still
              be reproduced exactly as it was.
            */}
            A raise is a new line with a later date - the old one stays, so a payslip already issued never changes.
          </CardDescription>
        </div>
        {canEdit && !adding && <Button size="sm" onClick={() => setAdding(true)}><Plus />Set salary</Button>}
      </CardHeader>

      <CardContent className="space-y-4">
        {adding && (
          <div className="space-y-3 rounded-2xl bg-muted/50 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="sal-from" className="text-[13px] font-semibold">Effective from</label>
                <Input id="sal-from" type="date" value={form.effectiveFrom}
                  onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
              </div>
              {PARTS.map((p) => (
                <div key={p.key}>
                  <label htmlFor={`sal-${p.key}`} className="text-[13px] font-semibold">
                    {p.label}{p.required && <span className="ml-1 font-normal text-danger">required</span>}
                  </label>
                  <Input id={`sal-${p.key}`} type="number" min={0} inputMode="numeric"
                    value={form[p.key]} onChange={(e) => setForm({ ...form, [p.key]: e.target.value })} />
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{p.why}</p>
                </div>
              ))}
            </div>
            <div>
              <label htmlFor="sal-note" className="text-[13px] font-semibold">Note <span className="font-normal text-muted-foreground">(optional)</span></label>
              <Input id="sal-note" value={form.note} placeholder="Annual review, April 2026"
                onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px]">
                Monthly gross <span className="font-display text-[20px] tabular-nums">{money(gross)}</span>
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
                <Button loading={busy} disabled={gross <= 0} onClick={() => void save()}>Save</Button>
              </div>
            </div>
          </div>
        )}

        {!rows ? <TableSkeleton rows={2} />
          : rows.length === 0 ? (
            <EmptyState icon={IndianRupee} title="No salary set"
              description={canEdit ? "Set one above - a payslip cannot be worked out without it." : "Ask HR to set one."}
              className="py-8" />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r, i) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold">
                      {money(r.gross)} a month
                      {/* The one in force today, so nobody has to read dates to find it. */}
                      {i === 0 && current?.id === r.id && (
                        <span className="ml-2 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-semibold text-tile-success-fg">
                          in force
                        </span>
                      )}
                    </p>
                    <p className="text-[12px] text-muted-foreground">
                      From {pretty(r.effectiveFrom)}
                      {" · "}Basic {money(r.basic)}
                      {r.hra ? ` · HRA ${money(r.hra)}` : ""}
                      {r.special ? ` · Special ${money(r.special)}` : ""}
                      {r.note ? ` · ${r.note}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </CardContent>
    </Card>
  );
}

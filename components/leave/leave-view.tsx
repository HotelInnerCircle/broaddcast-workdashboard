"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, X } from "lucide-react";
import { toast } from "sonner";
import { api, apiPaged, ClientApiError } from "@/lib/api/client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LEAVE_TYPES, LEAVE_TYPE_LABEL, type LeaveType } from "@/types";
import { LeaveHistory, LeaveBalance } from "./leave-panels";

export interface Approval { step: string; decision: string; decidedByName: string | null; decidedAt: string | null; note: string | null }
export interface LeaveRow {
  id: string; userId: string; userName: string; type: LeaveType; typeLabel: string;
  startDate: string; endDate: string; days: number; note: string | null; attachmentUrl: string | null;
  status: string; currentStep: string | null; approvals: Approval[]; createdAt: string;
}
export interface BalanceRow {
  type: LeaveType; typeLabel: string; daysPerYear: number; monthlyAccrual: boolean;
  accrued: number; taken: number; pending: number; remaining: number;
}

const BLANK = { type: "" as LeaveType | "", startDate: "", endDate: "", note: "" };

/**
 * The leave plan (A91): History, Create and Balance, the three questions anyone actually has -
 * what happened to my requests, let me ask for time off, and how much do I have left.
 */
export function LeaveView({ canDecide, myUserId }: { canDecide: boolean; myUserId: string }) {
  const [tab, setTab] = useState("create");
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [balance, setBalance] = useState<BalanceRow[]>([]);
  const [form, setForm] = useState(BLANK);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [list, bal] = await Promise.all([
        apiPaged<LeaveRow>("/api/leave?limit=50", { fresh: true }),
        api<BalanceRow[]>("/api/leave/balance", { fresh: true }),
      ]);
      setRows(list.data);
      setBalance(bal);
    } catch { /* an empty screen says the same thing as an error toast here */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!form.type || !form.startDate || !form.endDate) { toast.error("Pick a type and both dates"); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("type", form.type);
      fd.append("startDate", form.startDate);
      fd.append("endDate", form.endDate);
      if (form.note.trim()) fd.append("note", form.note.trim());
      if (file) fd.append("attachment", file);
      const made = await api<LeaveRow>("/api/leave", { method: "POST", body: fd });
      setForm(BLANK); setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      toast.success(`${made.days} day(s) requested - it is with your team lead`);
      setTab("history");
      void load();
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Could not submit the plan");
    } finally { setBusy(false); }
  };

  const decide = async (row: LeaveRow, decision: "APPROVED" | "REJECTED") => {
    try {
      await api(`/api/leave/${row.id}/decision`, { method: "POST", json: { decision } });
      toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
      void load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not record your decision"); }
  };

  const cancel = async (row: LeaveRow) => {
    try { await api(`/api/leave/${row.id}/cancel`, { method: "POST" }); toast.success("Withdrawn"); void load(); }
    catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not withdraw it"); }
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full">
          <TabsTrigger value="history" className="flex-1">History</TabsTrigger>
          <TabsTrigger value="create" className="flex-1">Create</TabsTrigger>
          <TabsTrigger value="balance" className="flex-1">Balance</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "create" && (
        <div className="space-y-3 rounded-2xl bg-card p-5 shadow-card ring-1 ring-border/50">
          <select
            aria-label="Leave type" value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as LeaveType })}
            className="h-14 w-full rounded-2xl bg-muted px-5 text-[15px] outline-none ring-1 ring-transparent focus:ring-primary"
          >
            <option value="">Leave Type</option>
            {LEAVE_TYPES.map((t) => <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}</option>)}
          </select>

          <input aria-label="Start date" type="date" value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            className="h-14 w-full rounded-2xl bg-muted px-5 text-[15px] outline-none ring-1 ring-transparent focus:ring-primary" />

          <input aria-label="End date" type="date" value={form.endDate} min={form.startDate || undefined}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            className="h-14 w-full rounded-2xl bg-muted px-5 text-[15px] outline-none ring-1 ring-transparent focus:ring-primary" />

          <textarea aria-label="Additional note" rows={5} value={form.note} placeholder="Additional Note"
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            className="w-full resize-none rounded-2xl bg-muted px-5 py-4 text-[15px] outline-none ring-1 ring-transparent focus:ring-primary" />

          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => fileRef.current?.click()}
            className="flex size-24 flex-col items-center justify-center gap-1 rounded-2xl bg-muted text-muted-foreground hover:text-primary">
            {file ? <><Check className="size-6 text-success" /><span className="px-1 text-[10px] leading-tight">Attached</span></> : <Camera className="size-8" />}
          </button>
          {file && (
            <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }}
              className="flex items-center gap-1 text-[12.5px] font-semibold text-muted-foreground hover:text-danger">
              <X className="size-3.5" />Remove attachment
            </button>
          )}

          <button type="button" onClick={() => void submit()} disabled={busy}
            className="h-14 w-full rounded-full bg-sidebar text-[16px] font-bold text-white disabled:opacity-50">
            {busy ? "Submitting..." : "Submit"}
          </button>
        </div>
      )}

      {tab === "history" && <LeaveHistory rows={rows} canDecide={canDecide} myUserId={myUserId} onDecide={decide} onCancel={cancel} />}
      {tab === "balance" && <LeaveBalance rows={balance} />}
    </div>
  );
}

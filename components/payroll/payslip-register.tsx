"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Upload, Trash2, Check, AlertCircle } from "lucide-react";
import { api, ClientApiError } from "@/lib/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";

interface Payslip {
  id: string; period: string; from: string; to: string;
  fileName: string; fileSize: number; netPay: number | null;
  uploadedAt: string; publishedAt: string | null;
}
interface Row { userId: string; userName: string; employeeCode: string | null; payslip: Payslip | null }
interface Register {
  period: { key: string; from: string; to: string; label: string; calendar: boolean; startDay: number };
  rows: Row[];
  uploaded: number; missing: number; total: number;
}

const kb = (n: number) =>
  n < 1024 ? "under 1 KB" // rounding a small file to "0 KB" reads as a failed upload
  : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB`
  : `${(n / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Who has a payslip for this month and who does not (A102).
 *
 * The missing ones are the point. On the 30th the question is never "show me
 * what I uploaded" - it is "who have I still not done", and a list of only the
 * uploaded ones cannot answer that. So everybody in scope gets a row whether or
 * not there is a file behind it.
 */
export function PayslipRegister() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Register | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const pickers = useRef<Record<string, HTMLInputElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api<Register>(`/api/payslips?month=${month}`, { fresh: true })); }
    catch { setData(null); } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (row: Row, file: File) => {
    setBusy(row.userId);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("userId", row.userId);
      body.append("month", month);
      const res = await fetch("/api/payslips", { method: "POST", body, credentials: "same-origin" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(j.error?.message ?? "Upload failed");
      }
      toast.success(`${row.userName}'s payslip uploaded`);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(null); }
  };

  const open = async (slip: Payslip) => {
    try {
      const { url } = await api<{ url: string }>(`/api/payslips/${slip.id}`, { fresh: true });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not open it"); }
  };

  const remove = async (row: Row, slip: Payslip) => {
    if (!confirm(`Delete ${row.userName}'s payslip for ${data?.period.label}? They will no longer be able to see it.`)) return;
    setBusy(row.userId);
    try {
      await api(`/api/payslips/${slip.id}`, { method: "DELETE" });
      toast.success("Deleted");
      await load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not delete it"); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[12px] font-semibold">Payroll month
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="mt-1 block h-10 rounded-xl bg-card px-3 text-sm outline-none ring-1 ring-border focus:ring-primary" />
        </label>
        {data && (
          <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px]">
            {/* The days the month covers, spelled out - on a 26th cycle "September" is not September. */}
            <span className="rounded-full bg-muted px-3 py-1 font-semibold text-muted-foreground">Covers {data.period.label}</span>
            <span className={cn("rounded-full px-3 py-1 font-semibold",
              data.missing === 0 ? "bg-success-soft text-tile-success-fg" : "bg-warning-soft text-tile-warning-fg")}>
              {data.uploaded} of {data.total} uploaded
            </span>
          </div>
        )}
      </div>

      {loading ? <Skeleton className="h-96 rounded-2xl" />
        : !data ? <Card><CardContent className="p-0"><EmptyState icon={FileText} title="Nothing to show" description="Pick a month." className="py-10" /></CardContent></Card>
        : (
        <div className="space-y-2">
          {data.rows.map((row) => {
            const slip = row.payslip;
            return (
              <div key={row.userId} className={cn(
                "flex flex-wrap items-center gap-3 rounded-2xl bg-card p-3 shadow-card ring-1 ring-border/50",
                !slip && "ring-warning/40",
              )}>
                <Avatar name={row.userName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{row.userName}</p>
                  <p className="truncate text-[11.5px] text-muted-foreground">
                    {row.employeeCode ? `${row.employeeCode} - ` : ""}
                    {slip
                      ? <>{slip.fileName} ({kb(slip.fileSize)})</>
                      : <span className="inline-flex items-center gap-1 text-warning"><AlertCircle className="size-3.5" />No payslip yet</span>}
                  </p>
                </div>

                {slip && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-semibold text-tile-success-fg">
                    <Check className="size-3.5" />Uploaded
                  </span>
                )}

                <input
                  ref={(el) => { pickers.current[row.userId] = el; }}
                  type="file" accept="application/pdf" className="hidden"
                  aria-label={`Payslip PDF for ${row.userName}`}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(row, f); e.target.value = ""; }}
                />
                <div className="flex shrink-0 items-center gap-1">
                  {slip && <Button variant="outline" size="sm" onClick={() => void open(slip)}><FileText />Open</Button>}
                  <Button variant="outline" size="sm" loading={busy === row.userId}
                    onClick={() => pickers.current[row.userId]?.click()}>
                    <Upload />{slip ? "Replace" : "Upload"}
                  </Button>
                  {slip && (
                    <Button variant="outline" size="icon" aria-label={`Delete ${row.userName}'s payslip`}
                      onClick={() => void remove(row, slip)}><Trash2 /></Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="px-1 text-[11.5px] leading-relaxed text-muted-foreground">
        A payslip is a PDF, stored privately and opened through a link that expires in five minutes.
        Uploading one makes it visible to that employee straight away. Replacing one removes the file
        it replaced, and both are written to the audit log.
      </p>
    </div>
  );
}

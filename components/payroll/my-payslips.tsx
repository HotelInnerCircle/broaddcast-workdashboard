"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FileText, Download } from "lucide-react";
import { api, ClientApiError } from "@/lib/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

interface Payslip {
  id: string; period: string; from: string; to: string;
  fileName: string; fileSize: number; netPay: number | null; publishedAt: string | null;
}

const monthName = (period: string) => {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString([], { month: "long", year: "numeric", timeZone: "UTC" });
};
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * A person's own payslips (A102).
 *
 * Each one says which days it covered, not only which month it is named after:
 * on a 26th-to-25th cycle "September" runs from 26 August, and somebody checking
 * a deduction needs to know which days were counted.
 *
 * Only published payslips are listed - one uploaded but withheld is a draft, and
 * the service will not hand out a link to it.
 */
export function MyPayslips() {
  const [rows, setRows] = useState<Payslip[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api<Payslip[]>("/api/payslips?mine=true", { fresh: true })
      .then(setRows)
      .catch(() => setFailed(true));
  }, []);

  const open = async (slip: Payslip) => {
    try {
      const { url } = await api<{ url: string }>(`/api/payslips/${slip.id}`, { fresh: true });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not open it"); }
  };

  if (failed) return <Card><CardContent className="p-0"><EmptyState icon={FileText} title="Could not load" description="Your payslips could not be fetched." className="py-10" /></CardContent></Card>;
  if (!rows) return <Skeleton className="h-64 rounded-2xl" />;
  if (rows.length === 0) {
    return (
      <Card><CardContent className="p-0">
        <EmptyState icon={FileText} title="No payslips yet"
          description="When HR publishes one it appears here, with the days it covers." className="py-10" />
      </CardContent></Card>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((slip) => (
        <div key={slip.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border/50">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><FileText className="size-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{monthName(slip.period)}</p>
            <p className="text-[11.5px] text-muted-foreground">
              Covers {dayLabel(slip.from)} - {dayLabel(slip.to)}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void open(slip)}>
            <Download />Download
          </Button>
        </div>
      ))}
      <p className="px-1 pt-1 text-[11.5px] text-muted-foreground">
        If a figure here looks wrong, check the attendance ledger for the same dates first - the days
        a payslip pays for are the days shown there. Then ask HR.
      </p>
    </div>
  );
}

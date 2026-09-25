"use client";
import { CalendarDays, Check, ClipboardList, Paperclip, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";
import type { LeaveRow, BalanceRow } from "./leave-view";

const STEP_LABEL: Record<string, string> = { TEAM_LEAD: "Team Lead", MANAGER: "Manager", HR: "HR" };
const pretty = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** Pending, approved or rejected - the thing anyone opens History to find out. */
export function StatusPill({ status }: { status: string }) {
  const fill = status === "APPROVED" ? "bg-success-soft text-tile-success-fg"
    : status === "REJECTED" ? "bg-danger-soft text-tile-danger-fg"
    : status === "CANCELLED" ? "bg-muted text-muted-foreground"
    : "bg-warning-soft text-tile-warning-fg";
  return <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold", fill)}>{status[0] + status.slice(1).toLowerCase()}</span>;
}

export function LeaveHistory({ rows, canDecide, myUserId, onDecide, onCancel }: {
  rows: LeaveRow[]; canDecide: boolean; myUserId: string;
  onDecide: (r: LeaveRow, d: "APPROVED" | "REJECTED") => Promise<void>;
  onCancel: (r: LeaveRow) => Promise<void>;
}) {
  if (rows.length === 0) {
    return <Card><CardContent className="p-0">
      <EmptyState icon={ClipboardList} title="No leave plans yet" description="Anything you ask for shows up here with where it has reached." className="py-10" />
    </CardContent></Card>;
  }
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <Card key={r.id}><CardContent className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{r.typeLabel}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                <CalendarDays className="size-3.5 shrink-0" />
                {pretty(r.startDate)}{r.endDate !== r.startDate ? ` to ${pretty(r.endDate)}` : ""} &middot; {r.days} day{r.days === 1 ? "" : "s"}
              </p>
              {r.userId !== myUserId && <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{r.userName}</p>}
            </div>
            <StatusPill status={r.status} />
          </div>

          {r.note && <p className="mt-2 rounded-xl bg-muted px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground">{r.note}</p>}
          {r.attachmentUrl && (
            <a href={r.attachmentUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary hover:underline">
              <Paperclip className="size-3.5" />See the attachment
            </a>
          )}

          {r.approvals.length > 0 && (
            <ol className="mt-3 flex flex-wrap gap-1.5">
              {r.approvals.map((a) => (
                <li key={a.step} className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold",
                  a.decision === "APPROVED" ? "bg-success-soft text-tile-success-fg"
                    : a.decision === "REJECTED" ? "bg-danger-soft text-tile-danger-fg"
                    : r.currentStep === a.step ? "bg-warning-soft text-tile-warning-fg" : "bg-muted text-muted-foreground")}>
                  {STEP_LABEL[a.step] ?? a.step}
                  {a.decidedByName ? ` - ${a.decidedByName}` : r.currentStep === a.step ? " - waiting" : ""}
                </li>
              ))}
            </ol>
          )}

          {r.status === "PENDING" && (
            <div className="mt-3 flex gap-2">
              {r.userId === myUserId ? (
                <Button size="sm" variant="outline" onClick={() => void onCancel(r)}><X className="size-4" />Withdraw</Button>
              ) : canDecide ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => void onDecide(r, "REJECTED")}><X className="size-4" />Reject</Button>
                  <Button size="sm" onClick={() => void onDecide(r, "APPROVED")}><Check className="size-4" />Approve</Button>
                </>
              ) : null}
            </div>
          )}
        </CardContent></Card>
      ))}
    </div>
  );
}

/** What is left, and the monthly figure people actually ask about. */
export function LeaveBalance({ rows }: { rows: BalanceRow[] }) {
  if (rows.every((r) => r.daysPerYear === 0)) {
    return <Card><CardContent className="p-0">
      <EmptyState icon={ClipboardList} title="No allowances set yet" description="HR sets how many days of each kind people get, in Shifts & holidays." className="py-10" />
    </CardContent></Card>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {rows.map((r) => (
        <Card key={r.type}><CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[15px] font-semibold">{r.typeLabel}</p>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-bold text-muted-foreground">{r.type}</span>
          </div>
          <p className="mt-2 font-display text-[34px] leading-none">{r.remaining}</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            day{r.remaining === 1 ? "" : "s"} left of {r.accrued} earned so far
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-2 rounded-full bg-primary" style={{ width: `${r.accrued > 0 ? Math.min(100, ((r.taken + r.pending) / r.accrued) * 100) : 0}%` }} />
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            {r.taken} taken{r.pending > 0 ? ` \u00b7 ${r.pending} awaiting approval` : ""} &middot; {r.daysPerYear}/year
            {r.monthlyAccrual ? ` (${Math.round((r.daysPerYear / 12) * 10) / 10} a month)` : " (all up front)"}
          </p>
        </CardContent></Card>
      ))}
    </div>
  );
}

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
              {r.approvals.map((a, i) => (
                <li key={a.step} className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold",
                  a.decision === "APPROVED" ? "bg-success-soft text-tile-success-fg"
                    : a.decision === "REJECTED" ? "bg-danger-soft text-tile-danger-fg"
                    : r.currentStep === a.step ? "bg-warning-soft text-tile-warning-fg" : "bg-muted text-muted-foreground")}>
                  <><span className="opacity-60">L{i + 1}</span> {STEP_LABEL[a.step] ?? a.step}</>
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
  if (rows.length === 0) {
    return <Card><CardContent className="p-0">
      <EmptyState icon={ClipboardList} title="Nothing to show yet" description="HR sets how many days of each kind people get, in Shifts & holidays." className="py-10" />
    </CardContent></Card>;
  }

  /*
   * One line per kind, the figure on the right (A123).
   *
   * Cards with progress bars were showing things like "0.8 days left of 0.8
   * earned so far", which is a sentence nobody can act on - there is no way to
   * book eight tenths of a day, and the bar measured a total that changes every
   * month. A list answers the question people open this screen with.
   *
   * One decimal always, so the column lines up and a half day reads as a half
   * day rather than as a rounding artefact.
   */
  return (
    <Card>
      <CardContent className="divide-y divide-border p-0">
        {rows.map((r) => (
          <div key={r.type} className="flex items-center justify-between gap-4 px-5 py-3.5">
            <span className="text-[14.5px] text-muted-foreground">{r.typeLabel}</span>
            <span className="flex items-baseline gap-2">
              <span className="font-display text-[22px] leading-none tabular-nums">{r.figure.toFixed(1)}</span>
              {/*
                What the number means, because it is not the same for every row:
                days you have left of what you are given, against days you have
                used of something you are not given at all.
              */}
              <span className="w-44 text-right text-[11px] text-muted-foreground">
                {r.carriesBalance ? "left" : "taken"}
                {/* Where part of it came from, so a bigger number than expected explains itself. */}
                {r.carriedIn > 0 ? ` · ${r.carriedIn} carried` : ""}
                {/*
                  Said out loud, because a figure below the allowance with
                  nothing taken looks like a deduction. It is not: the rest of
                  the year simply has not happened yet.
                */}
                {r.carriesBalance && r.monthlyAccrual && r.daysPerYear > 0
                  ? ` · ${r.daysPerYear}/yr, earned monthly`
                  : ""}
                {r.pending > 0 && r.carriesBalance ? ` · ${r.pending} awaiting` : ""}
              </span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

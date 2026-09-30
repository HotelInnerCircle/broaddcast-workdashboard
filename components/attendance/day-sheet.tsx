"use client";

import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { api, ClientApiError } from "@/lib/api/client";
import type { GridDay, GridRow } from "./auth-grid";

/**
 * One day, and what to do about it (A130).
 *
 * The half of the grid that makes it worth having. A cell shows what a day was;
 * this shows *why* - the swipes behind it, how late, how early - and lets
 * somebody settle it.
 *
 * The reason is required. A day changed by hand months later with no note is
 * indistinguishable from a mistake, and these are the entries that move money,
 * so they are the ones that get asked about. Making it mandatory is the
 * difference between a record that settles an argument and one that starts it.
 */

const MARKS: { status: string; label: string; tone: string; why: string }[] = [
  { status: "Present", label: "Present", tone: "bg-tile-success text-tile-success-fg", why: "They were here - a missed swipe, or a day worked away from a site." },
  { status: "Half Day", label: "Half day", tone: "bg-tile-warning text-tile-warning-fg", why: "Here for part of it." },
  { status: "Leave", label: "Leave", tone: "bg-tile-info text-tile-info-fg", why: "Approved time off. Spend it from their balance on the Leave screen." },
  { status: "Absent", label: "Absent", tone: "bg-tile-danger text-tile-danger-fg", why: "Away, unexplained. This day is not paid." },
];

const hhmm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—");
const hours = (s: number) => `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;

export function DaySheet({
  row, day, canSettle, onClose, onSettled,
}: {
  row: GridRow; day: GridDay; canSettle: boolean;
  onClose: () => void; onSettled: () => void;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!status) return;
    setBusy(true);
    try {
      await api("/api/attendance/authorise", {
        method: "PATCH",
        json: { userId: row.userId, date: day.date, status, note: note.trim() },
      });
      toast.success(`${row.userName} marked ${status.toLowerCase()} on ${day.date}`);
      onSettled();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save it"); }
    finally { setBusy(false); }
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-h-[92dvh] w-[min(720px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-card p-6 shadow-float">
          <DialogPrimitive.Title className="text-[19px] font-semibold">
            {row.userName}
            <span className="ml-2 text-[13px] font-normal text-muted-foreground">
              {row.employeeCode ?? "No code"} · {new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </span>
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-0.5 text-[13px] text-muted-foreground">
            What the day counted as, and why.
          </DialogPrimitive.Description>
          <DialogPrimitive.Close aria-label="Close" className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </DialogPrimitive.Close>

          {/* The facts first. Somebody deciding needs what happened before what to do about it. */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["First swipe", hhmm(day.clockIn)],
              ["Last swipe", hhmm(day.clockOut)],
              ["Worked", day.workSeconds ? hours(day.workSeconds) : "—"],
              ["Swipes", String(day.swipes)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-muted px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p>
                <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-muted px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Counted as</p>
              <p className="mt-0.5 text-[15px] font-semibold">{day.kind}{day.detail ? ` · ${day.detail}` : ""}</p>
            </div>
            <div className="rounded-xl bg-muted px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Late in</p>
              <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{day.lateByMinutes ? `${day.lateByMinutes} min` : "—"}</p>
            </div>
            <div className="rounded-xl bg-muted px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Early out</p>
              <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{day.earlyByMinutes ? `${day.earlyByMinutes} min` : "—"}</p>
            </div>
          </div>

          {/*
            Only for a day that was theirs to work. A date before somebody
            joined, or one that has not happened, is not an unpaid day - saying
            so would have HR settling days outside the employment.
          */}
          {!day.payable && day.kind !== "Before joining" && day.kind !== "Upcoming" && (
            <p className="mt-3 rounded-xl bg-danger-soft px-4 py-2.5 text-[13px] text-danger">
              This day is not paid as it stands.
            </p>
          )}

          {canSettle ? (
            <>
              <p className="mt-5 text-[13px] font-semibold">Change it to</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {MARKS.map((m) => (
                  <button
                    key={m.status}
                    type="button"
                    onClick={() => setStatus(m.status)}
                    title={m.why}
                    className={cn(
                      "rounded-full px-4 py-2 text-[13px] font-semibold ring-1 transition-all",
                      status === m.status ? `${m.tone} ring-transparent` : "bg-card ring-border hover:bg-muted",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {status && <p className="mt-2 text-[12px] text-muted-foreground">{MARKS.find((m) => m.status === status)?.why}</p>}

              <label htmlFor="settle-note" className="mt-4 block text-[13px] font-semibold">
                Why <span className="font-normal text-danger">required</span>
              </label>
              <textarea
                id="settle-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Forgot to swipe off - confirmed with their team lead."
                className="mt-1 w-full resize-none rounded-xl bg-muted px-4 py-3 text-[14px] outline-none ring-1 ring-transparent focus:ring-primary"
              />
              {/*
                Said plainly rather than left as a validation error somebody
                discovers by pressing the button: this note is the thing that
                explains a paid day to whoever asks in six months.
              */}
              <p className="mt-1 text-[11.5px] text-muted-foreground">
                Kept with the change, and shown to {row.userName.split(" ")[0]}. It is what explains this day later.
              </p>

              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button loading={busy} disabled={!status || note.trim().length < 3} onClick={() => void save()}>
                  Save this day
                </Button>
              </div>
            </>
          ) : (
            <p className="mt-5 rounded-xl bg-muted px-4 py-3 text-[13px] text-muted-foreground">
              You can see this day but not change it. Ask HR if it looks wrong.
            </p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

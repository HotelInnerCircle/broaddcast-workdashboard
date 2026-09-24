"use client";
import Link from "next/link";
import { Coffee, LogIn, LogOut, Pause, Play, Square, Timer as TimerIcon } from "lucide-react";
import { useTimer, formatHMS, formatHM } from "@/hooks/useTimer";
import { entryHref, entrySubtitle, entryTitle } from "@/components/timer/mini-timer";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";

/**
 * Desktop day hero (A81): the phone's timer card turned landscape, with the attendance panel
 * beside it. Same shared `useTimer` state as everywhere else, so nothing here is a second source
 * of truth - it is the same start/pause/break/stop and clock in/out the mini timer drives.
 */
export function DayHero() {
  const t = useTimer();
  const running = t.entry?.status === "RUNNING";
  const onBreak = Boolean(t.break);
  const att = t.summary?.attendance ?? null;
  const clockedIn = Boolean(att?.clockIn && !att.clockOut);

  return (
    <div className="hidden gap-4 md:flex">
      <div className="flex min-w-0 flex-1 flex-col justify-center rounded-3xl bg-sidebar p-6 text-white lg:flex-row lg:items-center lg:gap-7">
        {t.loading ? (
          <Skeleton className="h-24 w-64 bg-white/10" />
        ) : onBreak ? (
          <>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-warning" />
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-warning">On a break</span>
              </div>
              <p className="mt-2 font-display text-[52px] leading-none tabular-nums">{formatHMS(t.breakElapsed)}</p>
              {t.entry && <p className="mt-2 truncate text-[13px] text-white/60">&ldquo;{entryTitle(t.entry)}&rdquo; is paused</p>}
            </div>
            <div className="lg:flex-1" />
            <button type="button" onClick={() => void t.endBreak()} className="mt-4 h-12 shrink-0 rounded-full bg-primary px-7 text-[14.5px] font-bold text-primary-foreground lg:mt-0">End break</button>
          </>
        ) : t.entry ? (
          <>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", running ? "bg-success" : "bg-white/40")} />
                <span className={cn("text-[11px] font-bold uppercase tracking-[0.1em]", running ? "text-success" : "text-white/60")}>{running ? "Running" : "Paused"}</span>
              </div>
              <p className="mt-2 font-display text-[52px] leading-none tabular-nums">{formatHMS(t.elapsed)}</p>
              <Link href={entryHref(t.entry)} className="mt-2 block truncate text-[13px] text-white/60 hover:text-white">{entrySubtitle(t.entry) || entryTitle(t.entry)}</Link>
            </div>
            <div className="lg:flex-1" />
            <div className="mt-4 flex shrink-0 flex-wrap gap-2.5 lg:mt-0">
              {running ? (
                <button type="button" onClick={() => void t.pause()} className="inline-flex h-12 items-center gap-2 rounded-full bg-[#d4a27e] px-6 text-[14.5px] font-bold text-sidebar"><Pause className="size-4" />Pause</button>
              ) : (
                <button type="button" onClick={() => void t.resume()} className="inline-flex h-12 items-center gap-2 rounded-full bg-[#d4a27e] px-6 text-[14.5px] font-bold text-sidebar"><Play className="size-4" />Resume</button>
              )}
              <button type="button" onClick={() => void t.startBreak()} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/40 px-5 text-[14.5px] font-medium"><Coffee className="size-4" />Break</button>
              <button type="button" onClick={() => void t.stop()} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/40 px-6 text-[14.5px] font-medium"><Square className="size-3.5" />Stop</button>
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-white/25" />
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/60">No timer running</span>
              </div>
              <p className="mt-2 font-display text-[52px] leading-none tabular-nums text-white/35">00:00:00</p>
              <p className="mt-2 text-[13px] text-white/60">Pick a client and start tracking</p>
            </div>
            <div className="lg:flex-1" />
            <div className="mt-4 flex shrink-0 gap-2.5 lg:mt-0">
              <Link href="/timer" className="inline-flex h-12 items-center gap-2 rounded-full bg-[#d4a27e] px-7 text-[14.5px] font-bold text-sidebar"><TimerIcon className="size-4" />Start timer</Link>
              <button type="button" onClick={() => void t.startBreak()} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/40 px-5 text-[14.5px] font-medium"><Coffee className="size-4" />Break</button>
            </div>
          </>
        )}
      </div>

      <div className="flex w-[300px] shrink-0 flex-col justify-center rounded-3xl bg-success-soft p-6 text-tile-success-fg">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em]">{clockedIn ? "Clocked in" : att?.clockOut ? "Clocked out" : "Not clocked in"}</p>
        <p className="mt-1.5 font-display text-[40px] leading-none tabular-nums">
          {att?.clockIn ? att.clockIn.slice(11, 16) : att?.clockOut ? att.clockOut.slice(11, 16) : "--:--"}
        </p>
        <p className="mt-2 text-[12.5px]">
          {formatHM(t.summary?.workSeconds ?? 0)} worked &middot; {formatHM(t.summary?.breakSeconds ?? 0)} break
        </p>
        {clockedIn ? (
          <button type="button" onClick={() => void t.clockOut()} className="mt-4 h-11 rounded-full bg-success text-sm font-semibold text-white"><LogOut className="mr-2 inline size-4" />Clock out</button>
        ) : att?.clockOut ? (
          <p className="mt-4 rounded-full bg-white/50 py-2.5 text-center text-sm font-medium">Day complete</p>
        ) : (
          <button type="button" onClick={() => void t.clockIn()} className="mt-4 h-11 rounded-full bg-success text-sm font-semibold text-white"><LogIn className="mr-2 inline size-4" />Clock in</button>
        )}
      </div>
    </div>
  );
}

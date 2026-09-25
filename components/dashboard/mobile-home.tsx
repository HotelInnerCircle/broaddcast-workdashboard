"use client";
import Link from "next/link";
import { Bell, ChevronRight, Coffee, LogIn, LogOut, Pause, Play, Square, Timer as TimerIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { useTimer, formatHMS, formatHM } from "@/hooks/useTimer";
import { entryHref, entrySubtitle, entryTitle } from "@/components/timer/mini-timer";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { TILE_FILL, TILE_ICONS, TileBadge, visibleTiles, type LauncherTile } from "./tiles";

/** One line under the grid: what is wrong today, or nothing at all. */
export interface MobileAlert { href: string; text: string; tone: "danger" | "warning" }

/**
 * Phone home (A81): the launcher direction the owner picked - a cocoa header carrying the
 * greeting, the running timer lifted over it as a card, then a grid of tiles and one line saying
 * whether anything needs attention. Phones only (`md:hidden`); the desktop dashboard is separate.
 *
 * Every piece of timer and attendance state comes from the shared `useTimer` context, so start,
 * pause, break, clock in and clock out behave exactly as they do everywhere else.
 */
export function MobileHome({ tiles, alert, timezone }: { tiles: LauncherTile[]; alert?: MobileAlert | null; timezone?: string }) {
  const me = useAuth();
  const t = useTimer();
  const rt = useRealtime();
  const running = t.entry?.status === "RUNNING";
  const onBreak = Boolean(t.break);
  const att = t.summary?.attendance ?? null;
  const clockedIn = Boolean(att?.clockIn && !att.clockOut);
  const initials = me.name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="md:hidden">
      {/* Header: full-bleed inside the page padding */}
      <div className="relative -mx-4 -mt-5 overflow-hidden bg-[#7a4e33] px-5 pb-20 pt-4 text-white">
        <span aria-hidden className="pointer-events-none absolute -right-20 -top-28 size-72 rounded-full bg-white/[0.07]" />
        <span aria-hidden className="pointer-events-none absolute -bottom-28 -left-16 size-60 rounded-full bg-white/[0.05]" />

        {/* The phone has no top bar (A84), so this is the only bell - not a duplicate of one. */}
        <div className="relative flex justify-end">
          <Link href="/notifications" aria-label={`Notifications${rt.unreadNotifications ? `, ${rt.unreadNotifications} unread` : ""}`} className="relative flex size-10 items-center justify-center text-[#f6c46a]">
            <Bell className="size-[22px]" />
            {rt.unreadNotifications > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                {rt.unreadNotifications > 9 ? "9+" : rt.unreadNotifications}
              </span>
            )}
          </Link>
        </div>

        <div className="relative flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold leading-tight">Hi {me.name.split(" ")[0]}</p>
            <p className="mt-0.5 truncate text-[12.5px] text-white/75">{me.company?.name ?? ""}</p>
            <p className="mt-2.5 font-display text-[29px] leading-tight">{greeting}</p>
          </div>
          <div className="shrink-0 text-center">
            <span className="flex size-[68px] items-center justify-center rounded-full border-[3px] border-white/35 bg-[#d4a27e] text-[23px] font-bold text-[#2a2620]">{initials}</span>
            <p className="mt-1.5 text-[11.5px] font-medium text-white/80">{formatDate(new Date(), timezone)}</p>
          </div>
        </div>
      </div>

      {/* The running timer, lifted over the header */}
      <div className="relative -mt-14 rounded-3xl bg-card p-4 shadow-float">
        {onBreak ? (
          <>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-warning" />
              <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.09em] text-warning">On a break</span>
              <span className="text-[11.5px] font-semibold text-muted-foreground">{formatHM(t.summary?.workSeconds ?? 0)} today</span>
            </div>
            <div className="mt-1.5 flex items-end gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-display text-[42px] leading-none tabular-nums">{formatHMS(t.breakElapsed)}</p>
                {t.entry && <p className="mt-1.5 truncate text-xs text-muted-foreground">&ldquo;{entryTitle(t.entry)}&rdquo; is paused</p>}
              </div>
              <button type="button" onClick={() => void t.endBreak()} className="h-[46px] shrink-0 rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground">End break</button>
            </div>
          </>
        ) : t.entry ? (
          <>
            <div className="flex items-center gap-2">
              <span className={cn("size-2 rounded-full", running ? "bg-success" : "bg-muted-foreground")} />
              <span className={cn("flex-1 text-[11px] font-bold uppercase tracking-[0.09em]", running ? "text-success" : "text-muted-foreground")}>{running ? "Running" : "Paused"}</span>
              <span className="text-[11.5px] font-semibold text-muted-foreground">{formatHM(t.summary?.workSeconds ?? 0)} today</span>
            </div>
            <div className="mt-1.5 flex items-end gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-display text-[42px] leading-none tabular-nums">{formatHMS(t.elapsed)}</p>
                <Link href={entryHref(t.entry)} className="mt-1.5 block truncate text-xs text-muted-foreground">{entrySubtitle(t.entry) || entryTitle(t.entry)}</Link>
              </div>
              {running ? (
                <button type="button" onClick={() => void t.pause()} aria-label="Pause timer" className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><Pause className="size-[18px]" /></button>
              ) : (
                <button type="button" onClick={() => void t.resume()} aria-label="Resume timer" className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"><Play className="size-[18px]" /></button>
              )}
              <button type="button" onClick={() => void t.startBreak()} aria-label="Take a break" className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-muted text-foreground"><Coffee className="size-[17px]" /></button>
              <button type="button" onClick={() => void t.stop()} aria-label="Stop timer" className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-sidebar text-white"><Square className="size-4" /></button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-border" />
              <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">No timer running</span>
              <span className="text-[11.5px] font-semibold text-muted-foreground">{formatHM(t.summary?.workSeconds ?? 0)} today</span>
            </div>
            <div className="mt-1.5 flex items-end gap-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-display text-[42px] leading-none tabular-nums text-muted-foreground/50">00:00:00</p>
                <p className="mt-1.5 truncate text-xs text-muted-foreground">Pick a client and start tracking</p>
              </div>
              <Link href="/timer" className="inline-flex h-[46px] shrink-0 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground"><TimerIcon className="size-4" />Start</Link>
            </div>
          </>
        )}
      </div>

      {/* The launcher grid */}
      <div className="mt-5 flex items-baseline gap-2 px-1">
        <h2 className="flex-1 font-display text-[21px]">Quick actions</h2>
        <span className="text-[11.5px] font-semibold text-muted-foreground">
          {clockedIn ? `In at ${att!.clockIn!.slice(11, 16)}` : att?.clockOut ? "Day complete" : "Not clocked in"}
        </span>
      </div>
      <div className="mt-2.5 grid grid-cols-3 gap-2.5">
        {visibleTiles(me.role, me.company?.hiddenNav ?? [], tiles).map((tile) => {
          const Icon = TILE_ICONS[tile.icon];
          return (
            <Link key={tile.href + tile.label} href={tile.href} className="flex flex-col items-center gap-2 rounded-[18px] bg-card px-1.5 pb-3 pt-3.5 shadow-card ring-1 ring-border/50">
              <span className={cn("relative flex size-[46px] items-center justify-center rounded-full text-white", TILE_FILL[tile.tone])}>
                <Icon className="size-[22px]" strokeWidth={2} />
                <TileBadge badge={tile.badge} />
              </span>
              <span className="text-center text-[11.5px] font-semibold leading-tight">{tile.label}</span>
            </Link>
          );
        })}
      </div>

      {/* One line: is anything wrong today? */}
      {alert && (
        <Link
          href={alert.href}
          className={cn(
            "mt-3 flex items-center gap-3 rounded-[18px] px-4 py-3",
            alert.tone === "danger" ? "bg-danger-soft text-tile-danger-fg" : "bg-warning-soft text-tile-warning-fg",
          )}
        >
          <span className={cn("size-2.5 shrink-0 rounded-full", alert.tone === "danger" ? "bg-danger" : "bg-warning")} />
          <span className="min-w-0 flex-1 text-[13px] font-semibold">{alert.text}</span>
          <ChevronRight className="size-4 shrink-0" />
        </Link>
      )}

      {/* Clock in / out, where the reference app puts its one big action */}
      <div className="mt-3">
        {clockedIn ? (
          <button type="button" onClick={() => void t.clockOut()} className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-sidebar text-[15.5px] font-bold text-white">
            <LogOut className="size-5" />Clock out for the day
          </button>
        ) : att?.clockOut ? (
          <p className="rounded-full bg-muted py-3.5 text-center text-sm font-medium text-muted-foreground">
            Clocked out at {att.clockOut.slice(11, 16)} &middot; {formatHM(t.summary?.workSeconds ?? 0)} worked
          </p>
        ) : (
          <button type="button" onClick={() => void t.clockIn()} className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-success text-[15.5px] font-bold text-white">
            <LogIn className="size-5" />Clock in
          </button>
        )}
      </div>
    </div>
  );
}

"use client";
import Link from "next/link";
import { Coffee, LogIn, LogOut, Pause, Play, Square, Timer as TimerIcon } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTimer, formatHMS, formatHM } from "@/hooks/useTimer";
import { entryHref, entrySubtitle, entryTitle } from "@/components/timer/mini-timer";
import { cn } from "@/lib/utils/cn";

export interface MobileStat { label: string; value: string; hint?: string; progress?: number; tone?: "default" | "danger" | "success" }
export interface MobileItem { id: string; href: string; title: string; meta: string; tone: "danger" | "info" | "success" | "muted"; badge?: string }

const TONE: Record<MobileItem["tone"], string> = {
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  muted: "bg-muted text-muted-foreground",
};

/**
 * Mobile home screen ("Focus" direction, A66): a dark rounded hero owned by the running timer,
 * two soft stat sheets, then an "up next" list. Phones only - `md:hidden` in the pages that use it,
 * where the existing desktop dashboard is unchanged. All timer state comes from the shared
 * `useTimer` context, so start/pause/stop behave exactly as elsewhere.
 */
export function MobileHome({ greeting, stats, items, itemsTitle = "Up next", itemsHref = "/tasks" }: { greeting: string; stats: MobileStat[]; items: MobileItem[]; itemsTitle?: string; itemsHref?: string }) {
  const me = useAuth();
  const t = useTimer();
  const running = t.entry?.status === "RUNNING";
  const onBreak = Boolean(t.break);
  const att = t.summary?.attendance ?? null;
  const clockedIn = Boolean(att?.clockIn && !att.clockOut);

  return (
    <div className="md:hidden">
      {/* Hero: full-bleed within the page padding, rounded at the bottom */}
      <div className="relative -mx-4 -mt-5 overflow-hidden rounded-b-[30px] bg-sidebar px-5 pb-7 pt-5 text-white">
        <span aria-hidden className="pointer-events-none absolute -right-14 -top-16 size-56 rounded-full bg-primary opacity-20" />

        <div className="relative flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold">
            {me.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{greeting}</p>
            <p className="truncate text-[11px] text-white/60">{me.company?.name ?? ""}</p>
          </div>
        </div>

        {onBreak ? (
          <div className="relative mt-6 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-warning">&bull; On a break</p>
            <p className="mt-2 font-mono text-[56px] font-light leading-none tracking-tight tabular-nums">{formatHMS(t.breakElapsed)}</p>
            {t.entry && <p className="mt-1.5 text-[13px] text-white/70">&ldquo;{entryTitle(t.entry)}&rdquo; is paused</p>}
            <button type="button" onClick={() => void t.endBreak()} className="mt-5 h-12 rounded-full bg-primary px-8 text-sm font-bold text-primary-foreground">End break</button>
          </div>
        ) : t.entry ? (
          <div className="relative mt-6 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">{running ? "● Running" : "Paused"} &middot; {t.entry.client?.name ?? ""}</p>
            <p className="mt-2 font-mono text-[56px] font-light leading-none tracking-tight tabular-nums">{formatHMS(t.elapsed)}</p>
            <Link href={entryHref(t.entry)} className="mt-1.5 block truncate text-[13px] text-white/70">{entrySubtitle(t.entry) || entryTitle(t.entry)}</Link>
            <div className="mt-5 flex justify-center gap-2.5">
              {running ? (
                <button type="button" onClick={() => void t.pause()} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/25 px-6 text-sm font-semibold"><Pause className="size-4" />Pause</button>
              ) : (
                <button type="button" onClick={() => void t.resume()} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/25 px-6 text-sm font-semibold"><Play className="size-4" />Resume</button>
              )}
              <button type="button" onClick={() => void t.startBreak()} aria-label="Take a break" className="inline-flex size-12 items-center justify-center rounded-full border border-white/25"><Coffee className="size-4" /></button>
              <button type="button" onClick={() => void t.stop()} className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground"><Square className="size-3.5" />Stop</button>
            </div>
          </div>
        ) : (
          <div className="relative mt-6 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">No timer running</p>
            <p className="mt-2 font-mono text-[56px] font-light leading-none tracking-tight tabular-nums text-white/35">00:00:00</p>
            <p className="mt-1.5 text-[13px] text-white/60">Pick a client and start tracking</p>
            <div className="mt-5 flex justify-center gap-2.5">
              <Link href="/timer" className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-7 text-sm font-bold text-primary-foreground"><TimerIcon className="size-4" />Start timer</Link>
              <button type="button" onClick={() => void t.startBreak()} className="inline-flex h-12 items-center gap-2 rounded-full border border-white/25 px-5 text-sm font-semibold"><Coffee className="size-4" />Break</button>
            </div>
          </div>
        )}

        {/* attendance line */}
        <div className="relative mt-6 flex items-center justify-center gap-3 border-t border-white/10 pt-4 text-[11px] text-white/60">
          <span>Today <strong className="font-semibold text-white">{formatHM(t.summary?.workSeconds ?? 0)}</strong></span>
          <span className="text-white/25">|</span>
          <span>Break <strong className="font-semibold text-white">{formatHM(t.summary?.breakSeconds ?? 0)}</strong></span>
          <span className="text-white/25">|</span>
          {clockedIn ? (
            <button type="button" onClick={() => void t.clockOut()} className="inline-flex items-center gap-1.5 font-semibold text-white"><LogOut className="size-3.5" />Clock out</button>
          ) : att?.clockOut ? (
            <span className="font-semibold text-white">Day complete</span>
          ) : (
            <button type="button" onClick={() => void t.clockIn()} className="inline-flex items-center gap-1.5 font-semibold text-white"><LogIn className="size-3.5" />Clock in</button>
          )}
        </div>
      </div>

      {/* Two soft stat sheets */}
      {stats.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-3">
          {stats.slice(0, 4).map((s) => (
            <div key={s.label} className="rounded-2xl bg-card p-4 shadow-card ring-1 ring-border/60">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{s.label}</p>
              <p className={cn("mt-1.5 font-display text-[30px] leading-none tabular-nums", s.tone === "danger" && "text-danger", s.tone === "success" && "text-success")}>{s.value}</p>
              {typeof s.progress === "number" ? (
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted"><div className="h-1 rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, s.progress))}%` }} /></div>
              ) : s.hint ? (
                <p className="mt-2.5 text-[11px] font-medium text-muted-foreground">{s.hint}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Up next */}
      <div className="mt-6 flex items-baseline justify-between px-0.5">
        <h2 className="font-display text-[21px]">{itemsTitle}</h2>
        <Link href={itemsHref} className="text-[12.5px] font-semibold text-primary">See all</Link>
      </div>
      <div className="mt-2.5 rounded-2xl bg-card px-4 shadow-card ring-1 ring-border/60">
        {items.length === 0 ? (
          <p className="py-5 text-sm text-muted-foreground">Nothing needs your attention right now.</p>
        ) : items.slice(0, 5).map((it, i) => (
          <Link key={it.id} href={it.href} className={cn("flex items-center gap-3 py-3.5", i < Math.min(items.length, 5) - 1 && "border-b border-border")}>
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold", TONE[it.tone])}>{it.title.slice(0, 2).toUpperCase()}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{it.title}</span>
              <span className="block truncate text-[11.5px] text-muted-foreground">{it.meta}</span>
            </span>
            {it.badge && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold text-muted-foreground">{it.badge}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

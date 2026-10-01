"use client";
import Link from "next/link";
import { Bell, ChevronRight, Fingerprint, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useRealtime } from "@/hooks/useRealtime";
import { useTimer, formatHM } from "@/hooks/useTimer";
import { formatDate, formatTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";
import { TILE_FILL, TILE_ICONS, TileBadge, visibleTiles, type LauncherTile } from "./tiles";
import { TodaySwipes } from "./today-swipes";
import { TodayOverview } from "./today-overview";
import { onTheClock } from "@/lib/permissions";
import type { TodayAtAGlance } from "@/services/dashboardService";

/** One line under the grid: what is wrong today, or nothing at all. */
export interface MobileAlert { href: string; text: string; tone: "danger" | "warning" }

/**
 * Phone home (A81): the launcher direction the owner picked - a cocoa header carrying the
 * greeting, today swipes lifted over it as a card, then a grid of tiles and one line saying
 * whether anything needs attention. Phones only (`md:hidden`); the desktop dashboard is separate.
 *
 * Every piece of timer and attendance state comes from the shared `useTimer` context, so start,
 * pause, break, clock in and clock out behave exactly as they do everywhere else.
 */
export function MobileHome({ tiles, alert, timezone, today }: { tiles: LauncherTile[]; alert?: MobileAlert | null; timezone?: string; today?: TodayAtAGlance | null }) {
  const me = useAuth();
  // A139: whether this person clocks themselves in, or only watches.
  const clocked = onTheClock(me.role);
  const t = useTimer();
  const rt = useRealtime();
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
            <div className="mt-0.5 flex items-center gap-2">
              {/*
                The employee code, on the home screen (A107). It is what somebody
                is asked for on a call with HR, on a form, or at a gate - and
                hunting for it three screens deep is the reason people photograph
                it instead. Monospaced so it reads out digit by digit.
              */}
              {me.employeeCode && (
                <span className="shrink-0 rounded-md bg-white/15 px-2 py-0.5 font-mono text-[11.5px] font-semibold tracking-wide text-white">
                  {me.employeeCode}
                </span>
              )}
              <p className="truncate text-[12.5px] text-white/75">{me.company?.name ?? ""}</p>
            </div>
            <p className="mt-2.5 font-display text-[29px] leading-tight">{greeting}</p>
          </div>
          <div className="shrink-0 text-center">
            {/*
              Their own photograph, when they have uploaded one (A112). This was
              initials unconditionally - the avatar was on the profile screen and
              nowhere else, so the one place that greets you by name showed a
              letter. The initials stay as the fallback, and are what a broken or
              expired link falls back to rather than a torn-image icon.
            */}
            <span className="relative flex size-[68px] items-center justify-center overflow-hidden rounded-full border-[3px] border-white/35 bg-[#d4a27e] text-[23px] font-bold text-[#2a2620]">
              {initials}
              {me.avatarUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- a signed storage URL, like <Avatar> renders
                <img
                  src={me.avatarUrl}
                  alt=""
                  // Laid over the initials rather than instead of them, so a link
                  // that has expired or will not load uncovers the letters
                  // instead of leaving an empty circle or a torn-image icon.
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                  className="absolute inset-0 size-full object-cover"
                />
              )}
            </span>
            <p className="mt-1.5 text-[11.5px] font-medium text-white/80">{formatDate(new Date(), timezone)}</p>
          </div>
        </div>
      </div>

      {/*
        Today swipes, lifted over the header (A106).

        This was the running timer. The owner asked for it to go: the phone is
        mostly used to swipe in and out, and the timer has its own screen and a
        mini timer that follows you around anyway - so the space belongs to the
        thing people open the app to check.
      */}
      {/*
        A139: only for somebody who swipes. The admin oversees attendance rather
        than recording it, so a card of their own swipes would always be empty -
        and reading as though they had forgotten to swipe is worse than absent.
      */}
      {clocked
        ? <TodaySwipes userId={me.userId} userName={me.name} />
        : today
          ? <TodayOverview today={today} />
          : null}

      {/* The launcher grid */}
      <div className="mt-5 flex items-baseline gap-2 px-1">
        <h2 className="flex-1 font-display text-[21px]">Quick actions</h2>
        {clocked && (
          <span className="text-[11.5px] font-semibold text-muted-foreground">
            {clockedIn ? `In at ${formatTime(att!.clockIn!, timezone)}` : att?.clockOut ? "Day complete" : "Not clocked in"}
          </span>
        )}
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

      {/*
        The one big action is the swipe (A121). It used to be Clock in, sitting
        directly under a card showing today's swipes - two buttons for one fact,
        and the day was counted from whichever of them somebody remembered.
      */}
      <div className="mt-3">
        {!clocked ? (
          /*
            The admin's one big action is not a swipe (A139). It is the thing the
            role is actually for: everybody's day, on one screen.
          */
          <Link href="/attendance" className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-foreground text-[15.5px] font-bold text-background">
            <Users className="size-5" />See who is in today
          </Link>
        ) : att?.clockOut ? (
          <p className="rounded-full bg-muted py-3.5 text-center text-sm font-medium text-muted-foreground">
            Off duty at {formatTime(att.clockOut, timezone)} &middot; {formatHM(t.summary?.workSeconds ?? 0)} worked
          </p>
        ) : (
          <Link href="/swipe" className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-success text-[15.5px] font-bold text-white">
            <Fingerprint className="size-5" />{clockedIn ? "Swipe off duty" : "Swipe on duty"}
          </Link>
        )}
      </div>
    </div>
  );
}

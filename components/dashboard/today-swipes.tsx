"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Fingerprint, ChevronRight } from "lucide-react";
import { api } from "@/lib/api/client";
import { DaySwipesSheet } from "@/components/reports/day-swipes-sheet";
import { cn } from "@/lib/utils/cn";

interface Swipe {
  id: string; type: string; at: string; status: string;
  siteName: string | null; withinGeofence: boolean;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Today's swipes, on the phone's home screen (A106).
 *
 * The card the owner wanted in place of the running timer: what you have
 * recorded today, at a glance, without opening anything. Tapping it opens the
 * same day sheet the attendance ledger uses - the photo, the place and the
 * distance - rather than a second, slightly different version of it.
 *
 * It refreshes when a swipe lands, so the card is right immediately after
 * somebody swipes rather than after they pull to refresh.
 */
export function TodaySwipes({ userId, userName }: { userId: string; userName: string }) {
  const [swipes, setSwipes] = useState<Swipe[] | null>(null);
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(() => {
    api<{ data: Swipe[] } | Swipe[]>(`/api/attendance/swipes?from=${today}&to=${today}&limit=20`, { fresh: true })
      .then((r) => setSwipes(Array.isArray(r) ? r : r.data))
      .catch(() => setSwipes([]));
  }, [today]);

  useEffect(() => { load(); }, [load]);

  /*
   * Reloaded when the screen comes back into view. Somebody swipes on the swipe
   * screen and comes straight back here, and there is no realtime event for a
   * swipe to listen to - so this is what makes the card right by the time they
   * are looking at it, rather than a refresh they have to think about.
   */
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, [load]);

  const rows = [...(swipes ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  const last = rows[rows.length - 1];

  return (
    <>
      <div className="relative -mt-14 rounded-3xl bg-card p-4 shadow-float">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-primary" />
          <span className="flex-1 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">Today&rsquo;s swipes</span>
          <span className="text-[11.5px] font-semibold text-muted-foreground">
            {swipes === null ? "" : rows.length === 0 ? "None yet" : `${rows.length} today`}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="mt-2 flex items-end gap-2.5">
            <div className="min-w-0 flex-1">
              <p className="font-display text-[32px] leading-none text-muted-foreground/50">--:--</p>
              <p className="mt-1.5 truncate text-xs text-muted-foreground">
                {swipes === null ? "Checking…" : "Swipe when you start and when you finish"}
              </p>
            </div>
            <Link href="/swipe" className="inline-flex h-[46px] shrink-0 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground">
              <Fingerprint className="size-4" />Swipe
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-2 flex items-end gap-2.5">
              {/*
                The latest swipe, not the range. A range of two times does not
                fit beside the button and wraps into it - and the strip below
                already lists every time, so it was saying the same thing twice.
                What is worth the large type is the state you are in now.
              */}
              <div className="min-w-0 flex-1">
                <p className="font-display text-[32px] leading-none tabular-nums">{timeOf(last.at)}</p>
                {/* No "first at ..." here: the strip below lists every time already, and adding it only made this line truncate. */}
                <p className="mt-1.5 truncate text-xs text-muted-foreground">
                  {last.type === "ON_DUTY" ? "On duty" : "Off duty"}
                  {last.withinGeofence ? (last.siteName ? ` at ${last.siteName}` : "") : " · away from a site"}
                </p>
              </div>
              <Link href="/swipe" className="inline-flex h-[46px] shrink-0 items-center gap-2 rounded-full bg-primary px-5 text-sm font-bold text-primary-foreground">
                <Fingerprint className="size-4" />Swipe
              </Link>
            </div>

            {/* The day as a strip: one chip per swipe, in the order they happened. */}
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Open today's swipes"
              className="mt-3 flex w-full items-center gap-1.5 overflow-x-auto rounded-2xl bg-muted/50 px-3 py-2 text-left"
            >
              {rows.map((s) => (
                <span
                  key={s.id}
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    s.status === "PENDING" ? "bg-warning-soft text-tile-warning-fg"
                      : s.status === "REJECTED" ? "bg-danger-soft text-tile-danger-fg"
                      : s.type === "ON_DUTY" ? "bg-success-soft text-tile-success-fg"
                      : "bg-card text-muted-foreground ring-1 ring-border",
                  )}
                >
                  {timeOf(s.at)}
                </span>
              ))}
              <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
            </button>
          </>
        )}
      </div>

      {open && <DaySwipesSheet userId={userId} userName={userName} date={today} onClose={() => setOpen(false)} />}
    </>
  );
}

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TodayAtAGlance } from "@/services/dashboardService";

/**
 * Who is in today, for somebody who watches rather than swipes (A139).
 *
 * This is the admin's answer to the question their role is actually about. It
 * replaces a card that said "Present, late, half-day and absent counts for
 * today - coming soon", which had been promising that for long enough.
 *
 * "Yet to swipe" rather than "absent" on purpose: the day is not over, and
 * calling somebody absent at eleven in the morning is a claim the data does not
 * support. The attendance screen is where that becomes a judgement, so every
 * number here is a link into it rather than a verdict.
 */
export function TodayOverview({ today, className }: { today: TodayAtAGlance; className?: string }) {
  const cells = [
    { label: "On duty now", value: today.onDuty, tone: "success" as const },
    { label: "Swiped in", value: today.swiped, tone: "plain" as const },
    { label: "Yet to swipe", value: today.yetToSwipe, tone: today.yetToSwipe > 0 ? ("warning" as const) : ("plain" as const) },
    { label: "On leave", value: today.leave, tone: "plain" as const },
  ];

  return (
    <div className={cn("rounded-[22px] bg-card p-4 shadow-card ring-1 ring-border/50", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[19px]">Today</h2>
        {/* This card's own way in, not a second menu entry - see A142. */}
        <Link href="/attendance" data-cta className="flex items-center gap-0.5 text-[12px] font-semibold text-muted-foreground">
          {today.headcount} on the clock<ChevronRight className="size-3.5" />
        </Link>
      </div>

      {/* A day nobody is rostered for would otherwise read as everybody missing. */}
      {!today.isWorkingDay && (
        <p className="mt-1 text-[12px] text-muted-foreground">Not a working day on the company calendar.</p>
      )}

      <dl className="mt-3 grid grid-cols-4 gap-2">
        {cells.map((c) => (
          <div key={c.label} className={cn(
            "rounded-2xl px-2 py-2.5 text-center",
            c.tone === "success" ? "bg-success-soft text-tile-success-fg"
              : c.tone === "warning" ? "bg-warning-soft text-tile-warning-fg"
                : "bg-muted",
          )}>
            <dd className="font-display text-[22px] leading-none tabular-nums">{c.value}</dd>
            <dt className="mt-1 text-[10.5px] font-semibold leading-tight">{c.label}</dt>
          </div>
        ))}
      </dl>

      {/*
        Said, not linked (A142). It used to be a second link to /attendance
        inside a card whose heading already goes there - two ways out of one
        small card, a few centimetres apart. The whole card is the way in.
      */}
      {today.late > 0 && (
        <p className="mt-2.5 flex items-center gap-2 text-[12.5px] font-semibold text-tile-warning-fg">
          <span className="size-2 rounded-full bg-warning" />
          {today.late} came in late
        </p>
      )}
    </div>
  );
}

"use client";
import Link from "next/link";
import { Timer, Pause, Play, Square, Coffee, LogIn, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTimer, formatHMS, formatHM } from "@/hooks/useTimer";
import { cn } from "@/lib/utils/cn";
import { entryHref, entrySubtitle, entryTitle } from "./mini-timer";

/** Large stopwatch for the employee dashboard (spec 12.5): what am I doing right now. */
export function StopwatchWidget() {
  const t = useTimer();
  const running = t.entry?.status === "RUNNING";
  const att = t.summary?.attendance ?? null;
  const clockedIn = Boolean(att?.clockIn && !att.clockOut);
  return (
    <Card className={cn("border-primary/30", t.break ? "bg-warning-soft/30" : running ? "bg-success-soft/30" : "bg-primary-soft/40")}>
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        {t.loading ? <Skeleton className="h-32 w-64" /> : t.break ? (
          <>
            <div className="flex size-14 items-center justify-center rounded-full bg-warning text-white"><Coffee className="size-7" /></div>
            <p className="font-mono text-5xl font-semibold tabular-nums tracking-tight">{formatHMS(t.breakElapsed)}</p>
            <p className="text-sm text-muted-foreground">On break{t.entry ? ` - "${entryTitle(t.entry)}" is paused` : ""}</p>
            <Button size="lg" onClick={() => void t.endBreak()}>End break</Button>
          </>
        ) : t.entry ? (
          <>
            <p className="text-sm text-muted-foreground">{entrySubtitle(t.entry)}</p>
            <Link href={entryHref(t.entry)} className="font-display text-2xl hover:text-primary hover:underline">{entryTitle(t.entry)}</Link>
            <p className={cn("font-mono text-6xl font-semibold tabular-nums tracking-tight", running ? "text-success" : "text-muted-foreground")}>{formatHMS(t.elapsed)}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {running ? <Button size="lg" variant="outline" onClick={() => void t.pause()}><Pause />Pause</Button> : <Button size="lg" onClick={() => void t.resume()}><Play />Resume</Button>}
              <Button size="lg" variant="outline" onClick={() => void t.startBreak()}><Coffee />Break</Button>
              <Button size="lg" variant="danger" onClick={() => void t.stop()}><Square />Stop</Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground"><Timer className="size-7" /></div>
            <p className="font-mono text-5xl font-semibold tabular-nums tracking-tight">00:00:00</p>
            <p className="text-sm text-muted-foreground">No timer running. Pick a client and say what you are working on.</p>
            <Button asChild size="lg"><Link href="/timer"><Play />Start timer</Link></Button>
          </>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
          <span>Today <strong className="text-foreground">{formatHM(t.summary?.workSeconds ?? 0)}</strong></span>
          <span>Break <strong className="text-foreground">{formatHM(t.summary?.breakSeconds ?? 0)}</strong></span>
          {att?.status && <Badge variant={att.status === "Late" ? "warning" : "success"}>{att.status}</Badge>}
          {clockedIn ? <Button size="sm" variant="ghost" onClick={() => void t.clockOut()}><LogOut />Clock out</Button> : !att?.clockOut && <Button size="sm" variant="ghost" onClick={() => void t.clockIn()}><LogIn />Clock in</Button>}
        </div>
      </CardContent>
    </Card>
  );
}

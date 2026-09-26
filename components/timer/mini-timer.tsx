"use client";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { ProofField } from "@/components/ui/proof-field";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Pause, Play, Square, Coffee, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { useTimer, formatHMS, type ActiveEntry } from "@/hooks/useTimer";
import { cn } from "@/lib/utils/cn";

/** What a timer is "on": the task when attached, else the project, else the client (A58). */
export function entryTitle(e: ActiveEntry | null | undefined): string {
  return e?.task?.name ?? e?.project?.name ?? e?.client?.name ?? "timer";
}
export function entryHref(e: ActiveEntry | null | undefined): string {
  return e?.task?.id ? `/tasks/${e.task.id}` : e?.project?.id ? `/projects/${e.project.id}` : e?.client?.id ? `/clients/${e.client.id}` : "/timer";
}
/** Secondary line under the title: client, plus project when there is one, plus the working notes. */
export function entrySubtitle(e: ActiveEntry | null | undefined): string {
  return [e?.client?.name, e?.project?.name].filter(Boolean).join(" / ") + (e?.notes && e.notes !== entryTitle(e) ? ` - ${e.notes}` : "");
}

/**
 * Persistent mini-timer (spec 12.12): visible everywhere in the workspace while a timer or break
 * is active. Sticky under the navbar on desktop, pinned above the bottom navigation on mobile.
 */
export function MiniTimer() {
  const t = useTimer();
  const pathname = usePathname();
  // The phone home screen shows the same timer in its hero (A66), so the bar would duplicate it.
  const onHome = pathname.endsWith("/dashboard");
  if (!t.entry && !t.break) return <TimerDialogs />;
  const onBreak = Boolean(t.break);
  const running = t.entry?.status === "RUNNING";
  return (
    <>
      <div className={cn("sticky top-16 z-20 bg-card/95 px-3 py-2 shadow-card backdrop-blur md:top-[4.75rem] md:mx-0 md:rounded-2xl md:px-5", onHome ? "hidden md:block" : "", onBreak ? "border-l-4 border-l-warning" : "border-l-4 border-l-success")}>
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", onBreak ? "bg-warning-soft text-warning" : running ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>{onBreak ? <Coffee className="size-4" /> : <Timer className="size-4" />}</div>
          <div className="min-w-0 flex-1">
            {onBreak ? (
              <><p className="truncate text-sm font-medium">On break</p><p className="truncate text-xs text-muted-foreground">{t.entry ? `"${entryTitle(t.entry)}" is paused` : "Enjoy your break"}</p></>
            ) : (
              <><Link href={entryHref(t.entry)} className="block truncate text-sm font-medium hover:text-primary">{entryTitle(t.entry)}</Link><p className="truncate text-xs text-muted-foreground">{entrySubtitle(t.entry)}{!running && " - paused"}</p></>
            )}
          </div>
          <span className={cn("font-mono text-lg font-semibold tabular-nums", onBreak ? "text-warning" : running ? "text-success" : "text-muted-foreground")}>{formatHMS(onBreak ? t.breakElapsed : t.elapsed)}</span>
          <div className="flex items-center gap-1">
            {onBreak ? (
              <Button size="sm" onClick={() => void t.endBreak()}>End break</Button>
            ) : (
              <>
                {running ? <Button size="icon" variant="outline" aria-label="Pause" onClick={() => void t.pause()}><Pause /></Button> : <Button size="icon" variant="outline" aria-label="Resume" onClick={() => void t.resume()}><Play /></Button>}
                <Button size="icon" variant="outline" aria-label="Take a break" onClick={() => void t.startBreak()} className="hidden sm:inline-flex"><Coffee /></Button>
                <Button size="icon" variant="danger" aria-label="Stop" onClick={() => void t.stop()}><Square /></Button>
              </>
            )}
          </div>
        </div>
      </div>
      <TimerDialogs />
    </>
  );
}

/** Both timer dialogs live here so they are mounted everywhere the mini-timer is. */
export function TimerDialogs() {
  return <><ConflictDialog /><StopDialog /></>;
}

/** Mandatory work notes (A53): the textarea + validation shared by the stop and switch dialogs. */
function NotesField({ id, value, onChange, autoFocus }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <Field label="What did you complete?" htmlFor={id} hint="Required - this note goes on the time entry and into reports.">
      <Textarea id={id} rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Finished the checkout wireframes and shared them for review" autoFocus={autoFocus} maxLength={1000} />
    </Field>
  );
}
const valid = (v: string) => v.trim().length >= 3;

/** Stop: the timer cannot be stopped without describing the work that was completed (A53). */
export function StopDialog() {
  const t = useTimer();
  const me = useAuth();
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  // The company decides whether a picture has to come with the time (A105).
  const needsProof = me.company?.workProof?.timer !== false;
  // Pre-filled with what they said they were working on at start (A58); they confirm or refine it.
  useEffect(() => { if (t.stopPrompt) { setNotes(t.entry?.notes ?? ""); setProof(null); } }, [t.stopPrompt, t.entry?.notes]);
  const ready = valid(notes) && (!needsProof || Boolean(proof));
  return (
    <Dialog open={t.stopPrompt} onOpenChange={(o) => !o && t.resolveStop(null)}>
      <DialogContent title="Stop timer" description={t.entry ? `${formatHMS(t.elapsed)} on "${entryTitle(t.entry)}". Confirm or refine what you completed.` : undefined}>
        <NotesField id="stop-notes" value={notes} onChange={setNotes} autoFocus />
        <ProofField
          value={proof}
          onChange={setProof}
          required={needsProof}
          hint="A screenshot or photo of what you finished."
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => t.resolveStop(null)}>Keep running</Button>
          <Button variant="danger" disabled={!ready} onClick={() => t.resolveStop({ notes: notes.trim(), proof })}><Square />Stop timer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Spec 7.2: "You already have a timer running. Stop the current timer and start this one?" - the stopped entry needs its notes too. */
export function ConflictDialog() {
  const t = useTimer();
  const [notes, setNotes] = useState("");
  useEffect(() => { if (t.conflict) setNotes(t.conflict.notes ?? ""); }, [t.conflict]);
  return (
    <Dialog open={!!t.conflict} onOpenChange={(o) => !o && t.resolveConflict(null)}>
      <DialogContent title="Timer already running" description="You already have a timer running. Describe what you completed on it, then stop it and start the new one.">
        {t.conflict && (
          <div className="rounded-xl bg-muted/60 p-3 text-sm">
            <p className="font-medium">{entryTitle(t.conflict)}</p>
            <p className="text-xs text-muted-foreground">{entrySubtitle(t.conflict)} - {formatHMS(t.conflict.elapsedSeconds)} so far</p>
          </div>
        )}
        <NotesField id="switch-notes" value={notes} onChange={setNotes} />
        <DialogFooter>
          <Button variant="outline" onClick={() => t.resolveConflict(null)}>Keep current timer</Button>
          <Button disabled={!valid(notes)} onClick={() => t.resolveConflict(notes.trim())}>Stop and switch</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

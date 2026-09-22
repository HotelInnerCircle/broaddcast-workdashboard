"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ClientApiError } from "@/lib/api/client";

export interface ActiveEntry {
  id: string; status: "RUNNING" | "PAUSED" | "COMPLETED"; client: { id: string; name: string | null } | null; project: { id: string; name: string | null } | null;
  task: { id: string; name: string | null } | null; notes: string | null; closedSeconds: number; openSince: string | null; elapsedSeconds: number; durationSeconds: number; serverNow: string; date: string;
}
export interface BreakInfo { id: string; start: string; resumeEntryId: string | null }
export interface DaySummary { date: string; workSeconds: number; breakSeconds: number; sessionSeconds: number; weekSeconds: number; entries: number; attendance: { clockIn: string | null; clockOut: string | null; status: string } | null }
interface TimerPayload { entry: ActiveEntry | null; break: BreakInfo | null; serverNow: string; summary: DaySummary }

interface TimerApi {
  entry: ActiveEntry | null; break: BreakInfo | null; summary: DaySummary | null; loading: boolean;
  /** Display-only seconds derived from server timestamps + a server clock offset (spec 7.1). */
  elapsed: number; breakElapsed: number;
  refresh: () => Promise<void>;
  /** Timers run on a client with notes (A58); project/task are attached only when started from a task page. */
  start: (clientId: string, opts: { notes: string; projectId?: string; taskId?: string; force?: boolean; previousNotes?: string }) => Promise<boolean>;
  pause: () => Promise<void>; resume: () => Promise<void>;
  /** Without `notes` this opens the stop dialog, which collects the mandatory work notes (A53). */
  stop: (notes?: string) => Promise<void>;
  startBreak: () => Promise<void>; endBreak: () => Promise<void>;
  clockIn: () => Promise<void>; clockOut: () => Promise<void>;
  /** Confirm-and-switch: resolve with the notes for the running entry to switch, or null to keep it. */
  conflict: ActiveEntry | null; resolveConflict: (previousNotes: string | null) => void;
  /** Stop dialog: resolve with the work notes, or null to cancel. */
  stopPrompt: boolean; resolveStop: (notes: string | null) => void;
}

const Ctx = createContext<TimerApi | null>(null);

export function TimerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TimerPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0); // serverNow - clientNow (ms)
  const [tick, setTick] = useState(0);
  const [conflict, setConflict] = useState<{ entry: ActiveEntry; resolve: (v: string | null) => void } | null>(null);
  const [stopPrompt, setStopPrompt] = useState<{ resolve: (v: string | null) => void } | null>(null);
  const mounted = useRef(true);

  const apply = useCallback((p: TimerPayload) => {
    setOffset(new Date(p.serverNow).getTime() - Date.now());
    setState(p);
  }, []);

  const refresh = useCallback(async () => {
    try { apply(await api<TimerPayload>("/api/timer")); } catch { /* keep last state */ } finally { if (mounted.current) setLoading(false); }
  }, [apply]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const iv = setInterval(refresh, 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => { mounted.current = false; clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  const active = Boolean(state?.entry && state.entry.status === "RUNNING") || Boolean(state?.break);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [active]);

  const now = Date.now() + offset;
  const elapsed = useMemo(() => {
    const e = state?.entry;
    if (!e) return 0;
    if (e.status !== "RUNNING" || !e.openSince) return e.closedSeconds;
    return e.closedSeconds + Math.max(0, Math.floor((now - new Date(e.openSince).getTime()) / 1000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.entry, now, tick]);
  const breakElapsed = state?.break ? Math.max(0, Math.floor((now - new Date(state.break.start).getTime()) / 1000)) : 0;

  const fail = (e: unknown, fallback: string) => { toast.error(e instanceof ClientApiError ? e.message : fallback); };
  const patchEntry = (entry: ActiveEntry | null, br?: BreakInfo | null) => setState((s) => (s ? { ...s, entry, ...(br !== undefined ? { break: br } : {}) } : s));

  const start = useCallback(async (clientId: string, opts: { notes: string; projectId?: string; taskId?: string; force?: boolean; previousNotes?: string }): Promise<boolean> => {
    try {
      const entry = await api<ActiveEntry>("/api/timer/start", { method: "POST", json: { clientId, projectId: opts.projectId, taskId: opts.taskId, notes: opts.notes, force: opts.force ?? false, previousNotes: opts.previousNotes } });
      setOffset(new Date(entry.serverNow).getTime() - Date.now());
      patchEntry(entry, null);
      toast.success(`Timer started for ${entry.task?.name ?? entry.project?.name ?? entry.client?.name ?? "client"}`);
      void refresh();
      return true;
    } catch (e) {
      if (e instanceof ClientApiError && e.code === "TIMER_ACTIVE" && !opts.force) {
        const current = (e.details as { entry?: ActiveEntry }).entry;
        if (current) {
          const previousNotes = await new Promise<string | null>((resolve) => setConflict({ entry: current, resolve }));
          setConflict(null);
          return previousNotes ? start(clientId, { ...opts, force: true, previousNotes }) : false;
        }
      }
      fail(e, "Could not start the timer");
      return false;
    }
  }, [refresh]);

  const pause = useCallback(async () => { try { patchEntry(await api<ActiveEntry>("/api/timer/pause", { method: "POST" })); } catch (e) { fail(e, "Could not pause"); } }, []);
  const resume = useCallback(async () => { try { const en = await api<ActiveEntry>("/api/timer/resume", { method: "POST" }); setOffset(new Date(en.serverNow).getTime() - Date.now()); patchEntry(en, null); } catch (e) { fail(e, "Could not resume"); } }, []);
  const stop = useCallback(async (notes?: string) => {
    let text = notes;
    if (!text) {
      text = (await new Promise<string | null>((resolve) => setStopPrompt({ resolve }))) ?? undefined;
      setStopPrompt(null);
      if (!text) return;
    }
    try {
      const en = await api<ActiveEntry>("/api/timer/stop", { method: "POST", json: { notes: text } });
      patchEntry(null);
      toast.success(`Stopped: ${formatHMS(en.durationSeconds)} tracked`);
      void refresh();
    } catch (e) { fail(e, "Could not stop the timer"); }
  }, [refresh]);

  const startBreak = useCallback(async () => {
    try {
      const r = await api<{ break: BreakInfo }>("/api/breaks/start", { method: "POST" });
      setState((s) => (s ? { ...s, break: r.break, entry: s.entry ? { ...s.entry, status: "PAUSED", closedSeconds: elapsed, openSince: null } : null } : s));
      toast.success("Break started. Your timer is paused.");
      void refresh();
    } catch (e) { fail(e, "Could not start a break"); }
  }, [elapsed, refresh]);

  const endBreak = useCallback(async () => {
    try {
      const r = await api<{ resumeEntry: ActiveEntry | null }>("/api/breaks/end", { method: "POST" });
      setState((s) => (s ? { ...s, break: null } : s));
      if (r.resumeEntry) {
        toast("Break ended", { description: `Resume "${r.resumeEntry.task?.name ?? r.resumeEntry.project?.name ?? r.resumeEntry.client?.name ?? "previous timer"}"?`, action: { label: "Resume", onClick: () => void resume() }, duration: 15_000 });
      } else toast.success("Break ended");
      void refresh();
    } catch (e) { fail(e, "Could not end the break"); }
  }, [refresh, resume]);

  const clockIn = useCallback(async () => { try { const a = await api<{ status: string }>("/api/attendance/clock-in", { method: "POST" }); toast.success(a.status === "Late" ? "Clocked in (marked Late)" : "Clocked in"); await refresh(); } catch (e) { fail(e, "Could not clock in"); } }, [refresh]);
  const clockOut = useCallback(async () => { try { const a = await api<{ status: string; workSeconds: number }>("/api/attendance/clock-out", { method: "POST" }); toast.success(`Clocked out (${a.status}, ${formatHM(a.workSeconds)})`); await refresh(); } catch (e) { fail(e, "Could not clock out"); } }, [refresh]);

  const value: TimerApi = {
    entry: state?.entry ?? null, break: state?.break ?? null, summary: state?.summary ?? null, loading, elapsed, breakElapsed,
    refresh, start, pause, resume, stop, startBreak, endBreak, clockIn, clockOut,
    conflict: conflict?.entry ?? null, resolveConflict: (v) => conflict?.resolve(v),
    stopPrompt: Boolean(stopPrompt), resolveStop: (v) => stopPrompt?.resolve(v),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTimer(): TimerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTimer must be used inside TimerProvider");
  return v;
}

export function formatHMS(total: number): string {
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
export function formatHM(total: number): string {
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

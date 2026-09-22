"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client";
import { useRealtime, useRealtimeRefetch } from "@/hooks/useRealtime";
import { StatusTable, type StatusRow } from "./status-table";
import { HoursCard } from "./hours-card";

const EVENTS = ["presence:update", "timer:started", "timer:paused", "timer:stopped", "break:started", "break:ended"];

/**
 * Live employee status (spec 12.2): renders the server-provided rows, then refetches on any
 * presence/timer/break event so timer starts show up within ~2s without a refresh.
 */
export function LiveStatus({ initial, title, description, withHours }: { initial: StatusRow[]; title?: string; description?: string; withHours?: boolean }) {
  const rt = useRealtime();
  const [rows, setRows] = useState<StatusRow[]>(initial);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const refetch = useCallback(async () => { try { setRows(await api<StatusRow[]>("/api/dashboard/status", { fresh: true })); setUpdatedAt(new Date()); } catch { /* keep current rows */ } }, []);
  useRealtimeRefetch(EVENTS, refetch);
  useEffect(() => { const iv = setInterval(refetch, 60_000); return () => clearInterval(iv); }, [refetch]);
  return (
    <>
      <StatusTable rows={rows} title={title} description={description ?? (rt.connected ? `Live${updatedAt ? ` - updated ${updatedAt.toLocaleTimeString()}` : ""}` : "Reconnecting to live updates...")} />
      {withHours && <HoursCard rows={rows} />}
    </>
  );
}

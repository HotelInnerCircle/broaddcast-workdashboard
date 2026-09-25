"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardCheck, MapPin, X } from "lucide-react";
import { toast } from "sonner";
import { apiPaged, api, ClientApiError } from "@/lib/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils/cn";

interface Approval { step: string; decision: string; decidedByName: string | null; decidedAt: string | null; note: string | null }
interface Swipe {
  id: string; userName: string; type: string; at: string; date: string; photoUrl: string;
  lat: number; lng: number; accuracyMeters: number | null;
  siteName: string | null; distanceMeters: number | null; withinGeofence: boolean;
  status: string; currentStep: string | null; approvals: Approval[];
}

const STEP_LABEL: Record<string, string> = { TEAM_LEAD: "Team Lead", MANAGER: "Manager", HR: "HR" };
const distance = (m: number | null) => (m === null ? "no site set up" : m >= 1000 ? `${(m / 1000).toFixed(1)} km away` : `${m} m away`);

/** A83: the approval queue, and the history behind it. */
export function SwipesView({ canDecide }: { canDecide: boolean }) {
  const [tab, setTab] = useState(canDecide ? "waiting" : "all");
  const [rows, setRows] = useState<Swipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = tab === "waiting" ? "?mine=true&limit=50" : tab === "pending" ? "?status=PENDING&limit=50" : "?limit=50";
      const res = await apiPaged<Swipe>(`/api/attendance/swipes${q}`, { fresh: true });
      setRows(res.data);
    } catch { setRows([]); } finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (s: Swipe, decision: "APPROVED" | "REJECTED") => {
    setBusy(s.id);
    try {
      await api(`/api/attendance/swipes/${s.id}/decision`, { method: "POST", json: { decision } });
      toast.success(decision === "APPROVED" ? "Approved" : "Rejected");
      void load();
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Could not record your decision");
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {canDecide && <TabsTrigger value="waiting">Waiting on me</TabsTrigger>}
          <TabsTrigger value="pending">All pending</TabsTrigger>
          <TabsTrigger value="all">Everything</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? <p className="py-10 text-center text-sm text-muted-foreground">Loading...</p>
        : rows.length === 0 ? (
          <Card><CardContent className="p-0">
            <EmptyState icon={ClipboardCheck} title={tab === "waiting" ? "Nothing is waiting on you" : "No swipes yet"}
              description={tab === "waiting" ? "Swipes taken outside a work site will appear here when it is your turn to decide." : "Swipes taken from a work site are approved automatically and never appear as pending."}
              className="py-10" />
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {rows.map((s) => (
              <Card key={s.id}>
                <CardContent className="p-4">
                  <div className="flex gap-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.photoUrl} alt={`${s.userName} swiping ${s.type}`} className="size-28 shrink-0 rounded-2xl object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-[15px] font-semibold">{s.userName}</p>
                        <StatusPill status={s.status} />
                      </div>
                      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                        {s.type === "ON_DUTY" ? "On duty" : "Off duty"} &middot; {new Date(s.at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </p>
                      <p className={cn("mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium", s.withinGeofence ? "text-success" : "text-warning")}>
                        <MapPin className="size-3.5 shrink-0" />
                        {s.withinGeofence ? `At ${s.siteName}` : `${s.siteName ?? "Unknown site"} - ${distance(s.distanceMeters)}`}
                      </p>
                      <a href={`https://www.google.com/maps?q=${s.lat},${s.lng}`} target="_blank" rel="noopener noreferrer"
                        className="mt-1 inline-block text-[12px] font-semibold text-primary hover:underline">See it on a map</a>
                    </div>
                  </div>

                  {s.approvals.length > 0 && (
                    <ol className="mt-3 flex flex-wrap gap-1.5">
                      {s.approvals.map((a) => (
                        <li key={a.step} className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold",
                          a.decision === "APPROVED" ? "bg-success-soft text-tile-success-fg"
                            : a.decision === "REJECTED" ? "bg-danger-soft text-tile-danger-fg"
                            : s.currentStep === a.step ? "bg-warning-soft text-tile-warning-fg" : "bg-muted text-muted-foreground")}>
                          {STEP_LABEL[a.step] ?? a.step}
                          {a.decidedByName ? ` - ${a.decidedByName}` : s.currentStep === a.step ? " - waiting" : ""}
                        </li>
                      ))}
                    </ol>
                  )}

                  {canDecide && s.status === "PENDING" && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => void decide(s, "REJECTED")}>
                        <X className="size-4" />Reject
                      </Button>
                      <Button size="sm" disabled={busy === s.id} onClick={() => void decide(s, "APPROVED")}>
                        <Check className="size-4" />Approve
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const fill = status === "APPROVED" ? "bg-success-soft text-tile-success-fg"
    : status === "REJECTED" ? "bg-danger-soft text-tile-danger-fg" : "bg-warning-soft text-tile-warning-fg";
  return <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold", fill)}>{status[0] + status.slice(1).toLowerCase()}</span>;
}

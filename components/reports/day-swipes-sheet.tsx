"use client";

import { useEffect, useState } from "react";
import { MapPin, Camera, X, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/client";
import { Avatar } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils/cn";

interface Swipe {
  id: string;
  type: string;
  at: string;
  photoUrl: string;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  siteName: string | null;
  distanceMeters: number | null;
  withinGeofence: boolean;
  status: string;
  note?: string | null;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const metres = (m: number | null) => (m === null ? null : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`);

/**
 * What a day actually looked like: the photo taken at each swipe, when, and where.
 *
 * The photo and the coordinates are the record - a swipe is stamped server-side
 * from the same values that are stored, so the picture and the row cannot
 * disagree. The map link is a plain URL rather than an embedded map: an embed
 * would load a third-party script into a page showing an employee's location,
 * and opening a map is a decision the person looking should make.
 */
export function DaySwipesSheet({
  userId,
  userName,
  date,
  onClose,
}: {
  userId: string;
  userName: string;
  date: string;
  onClose: () => void;
}) {
  const [swipes, setSwipes] = useState<Swipe[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setSwipes(null);
    setFailed(false);
    api<{ data: Swipe[] } | Swipe[]>(`/api/attendance/swipes?userId=${userId}&from=${date}&to=${date}&limit=50`, { fresh: true })
      .then((r) => { if (alive) setSwipes(Array.isArray(r) ? r : r.data); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [userId, date]);

  // Escape closes it, like every other sheet in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pretty = new Date(`${date}T12:00:00Z`).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Swipes for ${userName} on ${pretty}`}>
      {/*
        The backdrop closes the sheet on a tap, but it is deliberately not a
        button: it would be a second control announced as "Close" and a second
        tab stop, both saying what the X already says. Keyboard and screen-reader
        users close it with the X or with Escape.
      */}
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-foreground/40 backdrop-blur-[2px]" />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-card shadow-card ring-1 ring-border sm:rounded-3xl">
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <Avatar name={userName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{userName}</p>
            <p className="truncate text-[12px] text-muted-foreground">{pretty}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {swipes === null && !failed && <div className="space-y-4">{[0, 1].map((i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}</div>}
          {failed && <EmptyState icon={Camera} title="Could not load" description="The swipes for this day could not be fetched." className="py-8" />}
          {swipes?.length === 0 && (
            <EmptyState icon={Camera} title="No swipes on this day" description="Attendance was recorded without a photo swipe, or the day was not worked." className="py-8" />
          )}

          <div className="space-y-4">
            {swipes?.map((s) => {
              /*
               * `siteName` is the *nearest* site, which is not the same as where
               * the person was. Showing it as the place made a swipe two
               * kilometres away read "Place: Head Office, 2.05 km from the
               * nearest site" - which says two contradictory things at once.
               */
              const place = s.withinGeofence ? (s.siteName ?? "A work site") : "Away from every work site";
              const nearest = s.siteName ? `from ${s.siteName}` : "from the nearest site";
              return (
                <div key={s.id} className="overflow-hidden rounded-2xl bg-muted/40 ring-1 ring-border/60">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a signed, expiring URL from private storage */}
                  <img src={s.photoUrl} alt={`Swipe at ${timeOf(s.at)}`} className="block max-h-72 w-full object-cover" />
                  <dl className="space-y-2 p-4 text-sm">
                    <div className="flex gap-3">
                      <dt className="w-20 shrink-0 text-muted-foreground">Time</dt>
                      <dd className="font-semibold tabular-nums">
                        {timeOf(s.at)}
                        <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          s.type === "ON_DUTY" ? "bg-success-soft text-tile-success-fg" : "bg-muted text-muted-foreground")}>
                          {s.type === "ON_DUTY" ? "On duty" : "Off duty"}
                        </span>
                      </dd>
                    </div>
                    <div className="flex gap-3">
                      <dt className="w-20 shrink-0 text-muted-foreground">Place</dt>
                      <dd className="min-w-0 flex-1">
                        <span className="font-medium">{place}</span>
                        <span className="block font-mono text-[11.5px] text-muted-foreground">{s.lat.toFixed(6)}, {s.lng.toFixed(6)}</span>
                      </dd>
                    </div>
                    {s.distanceMeters !== null && (
                      <div className="flex gap-3">
                        <dt className="w-20 shrink-0 text-muted-foreground">Distance</dt>
                        <dd className={cn("font-medium", !s.withinGeofence && "text-warning")}>
                          {metres(s.distanceMeters)}
                          <span className="text-muted-foreground"> {nearest}</span>
                        </dd>
                      </div>
                    )}
                    {s.accuracyMeters !== null && (
                      <div className="flex gap-3">
                        <dt className="w-20 shrink-0 text-muted-foreground">Accuracy</dt>
                        <dd className="text-muted-foreground">the phone claimed {metres(s.accuracyMeters)}</dd>
                      </div>
                    )}
                    {s.note && (
                      <div className="flex gap-3">
                        <dt className="w-20 shrink-0 text-muted-foreground">Note</dt>
                        <dd className="min-w-0 flex-1">{s.note}</dd>
                      </div>
                    )}
                    <div className="pt-1">
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90"
                      >
                        <MapPin className="size-4" />
                        View on map
                        <ExternalLink className="size-3.5 opacity-70" />
                      </a>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

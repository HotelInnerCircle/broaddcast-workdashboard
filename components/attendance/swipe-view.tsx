"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, LogIn, LogOut, MapPin, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api, ClientApiError } from "@/lib/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { distanceMeters } from "@/lib/geo";

export interface Site { id: string; name: string; lat: number; lng: number; radiusMeters: number; active: boolean }
export interface Fix { lat: number; lng: number; accuracy: number }

/**
 * The swipe screen (A83): a photo, a place, a moment.
 *
 * The nearest-site readout here is a courtesy so nobody is surprised - the server recomputes it
 * from scratch and its answer is the one that counts. Nothing the browser reports is trusted.
 */
export function SwipeView() {
  const [sites, setSites] = useState<Site[]>([]);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(true);
  const [locError, setLocError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "ON_DUTY" | "OFF_DUTY">(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void api<Site[]>("/api/work-sites").then(setSites).catch(() => setSites([])); }, []);

  const locate = useCallback(() => {
    setLocating(true); setLocError(null);
    if (!("geolocation" in navigator)) { setLocating(false); setLocError("This device cannot report its location."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); setLocating(false); },
      (err) => {
        setLocating(false);
        setLocError(err.code === err.PERMISSION_DENIED
          ? "Location is blocked. Allow it for this site, then try again."
          : "Could not get a location fix. Step outside or near a window and try again.");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }, []);
  useEffect(() => { locate(); }, [locate]);

  // Preview object URLs have to be released or they leak for as long as the page lives.
  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const active = sites.filter((s) => s.active);
  const nearest = fix && active.length
    ? active.map((s) => ({ site: s, d: distanceMeters(fix, s) })).sort((a, b) => a.d - b.d)[0]
    : null;
  const inside = nearest ? nearest.d <= nearest.site.radiusMeters : false;

  const send = async (type: "ON_DUTY" | "OFF_DUTY") => {
    if (!fix) { toast.error("Waiting for your location"); return; }
    if (!photo) { toast.error("Take a photo first"); return; }
    setBusy(type);
    try {
      const form = new FormData();
      form.append("photo", photo);
      form.append("type", type);
      form.append("lat", String(fix.lat));
      form.append("lng", String(fix.lng));
      form.append("accuracyMeters", String(Math.round(fix.accuracy)));
      const res = await api<{ status: string; siteName: string | null }>("/api/attendance/swipes", { method: "POST", body: form });
      setPhoto(null);
      if (fileRef.current) fileRef.current.value = "";
      if (res.status === "APPROVED") toast.success(`Swiped ${type === "ON_DUTY" ? "on duty" : "off duty"} at ${res.siteName}`);
      else toast.warning("Swipe recorded - it needs approval", { description: "You are outside every work site. Your team lead has been told." });
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Could not record the swipe");
    } finally { setBusy(null); }
  };

  const ready = Boolean(fix && photo) && busy === null;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      <LocationCard locating={locating} locError={locError} fix={fix} nearest={nearest} inside={inside} sites={active.length} onRetry={locate} />

      <Card>
        <CardContent className="p-4">
          <input ref={fileRef} type="file" accept="image/*" capture="user" className="hidden"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          {preview ? (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview} alt="Your swipe photo" className="h-56 w-full rounded-2xl object-cover" />
              <button type="button" onClick={() => fileRef.current?.click()} className="text-[13px] font-semibold text-primary hover:underline">
                Retake photo
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary">
              <Camera className="size-7" />
              <span className="text-[14px] font-semibold">Take your photo</span>
              <span className="text-[12px]">The time and place are added to it automatically</span>
            </button>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" disabled={!ready} onClick={() => void send("ON_DUTY")}
          className={cn("flex h-14 items-center justify-center gap-2 rounded-full text-[15px] font-bold text-white", ready ? "bg-success" : "bg-success/40")}>
          <LogIn className="size-5" />{busy === "ON_DUTY" ? "Sending..." : "On duty"}
        </button>
        <button type="button" disabled={!ready} onClick={() => void send("OFF_DUTY")}
          className={cn("flex h-14 items-center justify-center gap-2 rounded-full text-[15px] font-bold text-white", ready ? "bg-sidebar" : "bg-sidebar/40")}>
          <LogOut className="size-5" />{busy === "OFF_DUTY" ? "Sending..." : "Off duty"}
        </button>
      </div>
      {!ready && busy === null && (
        <p className="text-center text-[12.5px] text-muted-foreground">{!fix ? "Waiting for your location" : "Take a photo to swipe"}</p>
      )}
    </div>
  );
}

/** One line telling the person where they stand, before they commit to a swipe. */
function LocationCard({ locating, locError, fix, nearest, inside, sites, onRetry }: {
  locating: boolean; locError: string | null; fix: Fix | null;
  nearest: { site: Site; d: number } | null; inside: boolean; sites: number; onRetry: () => void;
}) {
  const tone = locError ? "danger" : !fix ? "muted" : inside ? "success" : "warning";
  const fill = {
    success: "bg-success-soft text-tile-success-fg",
    warning: "bg-warning-soft text-tile-warning-fg",
    danger: "bg-danger-soft text-tile-danger-fg",
    muted: "bg-muted text-muted-foreground",
  }[tone];

  return (
    <div className={cn("flex items-start gap-3 rounded-2xl px-5 py-4", fill)}>
      <span className="mt-0.5 shrink-0">
        {locError ? <TriangleAlert className="size-5" /> : inside ? <ShieldCheck className="size-5" /> : <MapPin className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        {locError ? <p className="text-[13.5px] font-semibold">{locError}</p>
          : locating ? <p className="text-[13.5px] font-semibold">Finding where you are...</p>
          : !fix ? <p className="text-[13.5px] font-semibold">No location yet</p>
          : sites === 0 ? <p className="text-[13.5px] font-semibold">No work sites set up yet - this swipe will need approval</p>
          : inside ? <p className="text-[13.5px] font-semibold">You are at {nearest!.site.name}</p>
          : <p className="text-[13.5px] font-semibold">{formatDistance(nearest!.d)} from {nearest!.site.name}</p>}
        {fix && !locError && (
          <p className="mt-0.5 text-[12px] opacity-80">
            {inside || sites === 0 ? `Accurate to about ${Math.round(fix.accuracy)} m` : "Outside every work site - this swipe goes for approval"}
          </p>
        )}
      </div>
      <button type="button" onClick={onRetry} aria-label="Check my location again" className="shrink-0 rounded-full p-1.5 hover:bg-black/5">
        <RefreshCw className={cn("size-4", locating && "animate-spin")} />
      </button>
    </div>
  );
}

const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

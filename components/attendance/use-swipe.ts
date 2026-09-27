"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { shrinkImage } from "@/lib/images/shrink";
import { toast } from "sonner";
import { api, apiPaged, ClientApiError } from "@/lib/api/client";
import { distanceMeters } from "@/lib/geo";
import { useAuth } from "@/hooks/useAuth";
import { describePhoto } from "@/lib/face/client";

export interface Site { id: string; name: string; lat: number; lng: number; radiusMeters: number; active: boolean }
export interface Fix { lat: number; lng: number; accuracy: number }
interface SwipeRow { type: string; status: string; at: string }

/**
 * Everything a swipe needs, shared by the full page and the sheet the bottom bar opens (A88).
 *
 * `onDuty` is derived from today's swipes: the newest one that was not rejected. A rejected swipe
 * never puts anyone on duty, and the day boundary means yesterday's forgotten on-duty does not
 * leave someone unable to start today.
 */
export function useSwipe(active: boolean) {
  const [sites, setSites] = useState<Site[]>([]);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [onDuty, setOnDuty] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const me = useAuth();
  /** Only read a face when the company checks them - the model is 6 MB. */
  const faceRequired = me.company?.faceCheck?.enabled === true;
  /** Retakes so far, sent with the swipe so a run of failures is visible to HR. */
  const attempts = useRef(0);
  const started = useRef(false);

  const loadDuty = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const res = await apiPaged<SwipeRow>(`/api/attendance/swipes?from=${today}&to=${today}&limit=20`, { fresh: true });
      const mine = res.data.filter((s) => s.status !== "REJECTED");
      setOnDuty(mine.length > 0 && mine[0].type === "ON_DUTY");
    } catch { setOnDuty(false); }
  }, []);

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

  // Location and duty state are fetched the moment the swipe is opened, so the fix is usually
  // ready by the time the photo comes back from the camera.
  useEffect(() => {
    if (!active) { started.current = false; return; }
    if (started.current) return;
    started.current = true;
    locate();
    void loadDuty();
    void api<Site[]>("/api/work-sites").then(setSites).catch(() => setSites([]));
  }, [active, locate, loadDuty]);

  const activeSites = sites.filter((s) => s.active);
  const nearest = fix && activeSites.length
    ? activeSites.map((s) => ({ site: s, d: distanceMeters(fix, s) })).sort((a, b) => a.d - b.d)[0]
    : null;
  const inside = nearest ? nearest.d <= nearest.site.radiusMeters : false;

  /** The one action that makes sense right now. Null until we know which it is. */
  const nextType: "ON_DUTY" | "OFF_DUTY" | null = onDuty === null ? null : onDuty ? "OFF_DUTY" : "ON_DUTY";

  const submit = useCallback(async (raw: File, note: string): Promise<boolean> => {
    if (!fix) { toast.error("Waiting for your location"); return false; }
    if (!nextType) { toast.error("Checking your last swipe"); return false; }
    setSending(true);
    try {
      /*
       * Resized before it leaves the phone (A109). Two swipes a day per person
       * of five megabytes each is a lot of mobile data for a photograph nobody
       * looks at above a thousand pixels - and the face below is read from the
       * shrunk bytes deliberately, so what was matched is what got stored.
       */
      const photo = await shrinkImage(raw, "proof");
      const form = new FormData();
      form.append("photo", photo);
      form.append("type", nextType);
      form.append("lat", String(fix.lat));
      form.append("lng", String(fix.lng));
      form.append("accuracyMeters", String(Math.round(fix.accuracy)));
      if (note.trim()) form.append("note", note.trim());

      /*
       * The face, read from the photo that was just taken (A108). Only when the
       * company asks for it - otherwise nobody pays for a 6 MB model download to
       * record a swipe that is not going to be checked.
       *
       * What is sent is the descriptor, never a verdict: the server decides
       * whether it matched. A failure to read a face is not a failure to swipe -
       * the swipe goes anyway, marked unverified, and a person is looked at
       * rather than turned away by a camera in bad light.
       */
      if (faceRequired) {
        const read = await describePhoto(photo);
        if (read?.descriptor) form.append("faceDescriptor", JSON.stringify(read.descriptor));
        form.append("faceAttempts", String(attempts.current));
      }

      const res = await api<{ status: string; siteName: string | null; faceVerdict?: string }>("/api/attendance/swipes", { method: "POST", body: form });
      const what = nextType === "ON_DUTY" ? "on duty" : "off duty";
      if (res.faceVerdict === "mismatch") {
        attempts.current += 1;
        toast.warning(`Swiped ${what} - your face was not recognised`, {
          description: "It has been recorded and sent for approval. If this keeps happening, enrol your face again from your profile.",
        });
      } else if (res.status === "APPROVED") toast.success(`Swiped ${what} at ${res.siteName}`);
      else toast.warning(`Swiped ${what} - it needs approval`, { description: "You are outside every work site. Your team lead has been told." });
      await loadDuty();
      return true;
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Could not record the swipe");
      return false;
    } finally { setSending(false); }
  }, [fix, nextType, loadDuty, faceRequired]);

  return { sites: activeSites, fix, locating, locError, locate, onDuty, nextType, nearest, inside, sending, submit };
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ScanFace, Check, Trash2, Loader2, CircleAlert } from "lucide-react";
import { api, ClientApiError } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { readFace, loadFaceModels, cameraSupported } from "@/lib/face/client";
import { cn } from "@/lib/utils/cn";

interface Status { enrolled: boolean; enrolledAt: string | null; samples: number; required: boolean }

const NEEDED = 4;

/**
 * Enrolling a face for attendance (A108).
 *
 * Four captures rather than one: a single photograph carries whatever that
 * moment happened to be - a shadow, an odd angle, a blink - and the average of
 * several is closer to the face than to any one picture of it. That difference
 * shows up later as people not being falsely rejected at the door.
 *
 * The consent tick is not decoration. A face descriptor is biometric data, which
 * under the DPDP Act needs consent to collect and deletion on request - so the
 * tick is required, the moment is recorded, and Remove is always available.
 */
export function FaceEnrolment() {
  const [status, setStatus] = useState<Status | null>(null);
  const [consent, setConsent] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [samples, setSamples] = useState<number[][]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const load = useCallback(() => {
    api<Status>("/api/me/face", { fresh: true }).then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => { load(); }, [load]);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCapturing(false);
  }, []);
  // The camera must not stay on when this screen goes away.
  useEffect(() => stop, [stop]);

  const start = async () => {
    if (!cameraSupported()) { toast.error("This device has no camera the browser can use"); return; }
    setSamples([]);
    setHint("Loading the face model - this happens once on this device…");
    try {
      await loadFaceModels();
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 } });
      stream.current = s;
      setCapturing(true);
      setHint("Look at the camera and hold still.");
      // The element exists only once capturing is true.
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; void video.current.play(); } });
    } catch (e) {
      setHint(null);
      toast.error(e instanceof Error && e.name === "NotAllowedError" ? "Camera permission was refused" : "The camera could not be opened");
    }
  };

  const capture = async () => {
    if (!video.current) return;
    setBusy(true);
    const read = await readFace(video.current);
    setBusy(false);
    if (!read.ok || !read.descriptor) { setHint(read.message); return; }
    const next = [...samples, read.descriptor];
    setSamples(next);
    setHint(next.length < NEEDED
      ? `Good. ${NEEDED - next.length} more - turn your head a little between each.`
      : "That is enough. Save it below.");
  };

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/me/face", { method: "POST", json: { consent: true, samples } });
      toast.success("Your face is enrolled");
      stop();
      setSamples([]);
      load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save it"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!confirm("Remove your enrolled face? You will need to enrol again to use face check.")) return;
    setBusy(true);
    try {
      await api("/api/me/face", { method: "DELETE" });
      toast.success("Removed");
      load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not remove it"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ScanFace className="size-4" />Face check</CardTitle>
        <CardDescription>
          {status?.required
            ? "Your company checks your face when you swipe. Enrol once so it can recognise you."
            : "Not required by your company yet. You can still enrol, and it will be used if they turn it on."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.enrolled ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-success-soft px-4 py-3">
            <Check className="size-4 shrink-0 text-tile-success-fg" />
            <p className="min-w-0 flex-1 text-[13px] text-tile-success-fg">
              Enrolled from {status.samples} captures
              {status.enrolledAt ? ` on ${new Date(status.enrolledAt).toLocaleDateString()}` : ""}.
            </p>
            <Button variant="outline" size="sm" loading={busy} onClick={() => void remove()}><Trash2 />Remove</Button>
          </div>
        ) : null}

        {capturing ? (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-2xl bg-muted">
              {/* Mirrored, because a preview that moves the wrong way is disorienting. */}
              <video ref={video} playsInline muted className="block max-h-80 w-full -scale-x-100 object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-foreground/60 px-3 py-2 text-center text-[12px] text-background">
                {samples.length} of {NEEDED} captured
              </div>
            </div>
            {hint && <p className="text-[12.5px] text-muted-foreground">{hint}</p>}
            <div className="flex flex-wrap gap-2">
              <Button loading={busy} onClick={() => void capture()} disabled={samples.length >= NEEDED}>
                {busy ? <Loader2 className="animate-spin" /> : <ScanFace />}Capture
              </Button>
              <Button variant="outline" onClick={stop}>Cancel</Button>
              {samples.length >= NEEDED && <Button loading={busy} onClick={() => void save()}><Check />Save my face</Button>}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 transition-colors",
              consent ? "bg-primary-soft ring-primary/40" : "bg-muted/40 ring-border")}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 shrink-0" />
              <span className="text-[12.5px] leading-relaxed">
                I agree to my face being used to confirm my attendance. I understand a description of my
                face is stored - not a photograph - that it is used only for this, and that I can remove
                it at any time.
              </span>
            </label>
            {hint && <p className="flex items-start gap-1.5 text-[12.5px] text-muted-foreground"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />{hint}</p>}
            <Button disabled={!consent} onClick={() => void start()}>
              <ScanFace />{status?.enrolled ? "Enrol again" : "Enrol my face"}
            </Button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              The first time, this device downloads a 6 MB face model. It happens once and works offline
              afterwards. Nothing about your face leaves your phone except a list of numbers, which cannot
              be turned back into a picture.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

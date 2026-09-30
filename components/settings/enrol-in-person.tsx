"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { UserRoundSearch, Camera, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ClientApiError } from "@/lib/api/client";
import { readFace, loadFaceModels, cameraSupported, FaceModelError } from "@/lib/face/client";

interface Person { id: string; name: string; employeeCode: string | null; designation: string | null }

const NEEDED = 4;

/**
 * Enrolling somebody's face with them standing there (A127).
 *
 * The opposite order from the phone. A person enrolling themselves has to be
 * approved afterwards because nobody watched; here the watching is the
 * enrolment, so it is approved as it is taken.
 *
 * It starts with the employee code on purpose - that is the thing printed on a
 * payslip and the thing people read out, so it is what somebody at a desk has
 * in front of them. The name comes back before the camera opens, because
 * photographing the right face onto the wrong account is the one mistake this
 * screen could make and never notice.
 */
export function EnrolInPerson({ onDone }: { onDone?: () => void }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Person | null>(null);
  const [looking, setLooking] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [samples, setSamples] = useState<number[][]>([]);
  const [shot, setShot] = useState<Blob | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCapturing(false);
  }, []);
  useEffect(() => stop, [stop]);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setLooking(true);
    setFound(null);
    try {
      const res = await api<{ data: Person[] }>(`/api/employees?q=${encodeURIComponent(q)}&limit=5`, { fresh: true }) as unknown as Person[];
      const rows = Array.isArray(res) ? res : ((res as unknown as { data: Person[] }).data ?? []);
      // An exact code beats a partial name: somebody who typed EMP005 means EMP005.
      const exact = rows.find((r) => (r.employeeCode ?? "").toLowerCase() === q.toLowerCase());
      const pick = exact ?? rows[0] ?? null;
      setFound(pick);
      if (!pick) toast.error(`Nobody matches "${q}"`);
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not look them up"); }
    finally { setLooking(false); }
  };

  const start = async () => {
    if (!cameraSupported()) { toast.error("This device has no camera the browser can use"); return; }
    setSamples([]); setShot(null);
    setHint("Getting the face model ready…");
    try {
      await loadFaceModels((pct) => setHint(pct >= 1 ? "Opening the camera…" : `Getting ready - ${Math.round(pct * 100)}%`));
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 } });
      stream.current = s;
      setCapturing(true);
      setHint(`Look at the camera. ${NEEDED} captures.`);
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; void video.current.play(); } });
    } catch (e) {
      setHint(null);
      toast.error(e instanceof FaceModelError ? e.message : "The camera could not be opened");
    }
  };

  const capture = async () => {
    if (!video.current) return;
    setBusy(true);
    let read;
    try { read = await readFace(video.current); }
    finally { setBusy(false); }
    if (!read.ok || !read.descriptor) { setHint(read.message); return; }
    if (!shot) {
      const c = document.createElement("canvas");
      c.width = video.current.videoWidth || 480;
      c.height = video.current.videoHeight || 640;
      c.getContext("2d")?.drawImage(video.current, 0, 0, c.width, c.height);
      await new Promise<void>((done) => c.toBlob((b) => { if (b) setShot(b); done(); }, "image/jpeg", 0.85));
    }
    const next = [...samples, read.descriptor];
    setSamples(next);
    setHint(next.length < NEEDED
      ? `Good. ${NEEDED - next.length} more - ask them to turn their head a little.`
      : "That is enough. Save it below.");
  };

  const save = async () => {
    if (!found) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("samples", JSON.stringify(samples));
      if (shot) fd.append("photo", new File([shot], "enrolment.jpg", { type: "image/jpeg" }));
      await api(`/api/face/enrolment/${found.id}`, { method: "POST", body: fd });
      toast.success(`${found.name} is enrolled and approved`, {
        description: "They can use a door device straight away.",
      });
      stop();
      setSamples([]); setShot(null); setFound(null); setQuery(""); setHint(null);
      onDone?.();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save it"); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><UserRoundSearch className="size-4" />Enrol somebody in person</CardTitle>
        <CardDescription>
          For the people who will walk up to a door device, or who cannot enrol from their own phone. Type their
          employee code, check the name, then photograph them. It is approved as you take it, because
          you are the one looking at them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1">
            <label htmlFor="enrol-code" className="text-[13px] font-semibold">Employee code or name</label>
            <Input
              id="enrol-code" value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void search(); }}
              placeholder="EMP005"
            />
          </div>
          <Button variant="outline" loading={looking} onClick={() => void search()}>Find</Button>
        </div>

        {found && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted px-4 py-3">
            <div className="min-w-0 flex-1">
              {/* The name, before the camera opens. Photographing the right face
                  onto the wrong account is the one mistake this screen could
                  make without anybody noticing. */}
              <p className="text-[15px] font-semibold">{found.name}</p>
              <p className="text-[12.5px] text-muted-foreground">
                {[found.employeeCode, found.designation].filter(Boolean).join(" · ") || "No code set"}
              </p>
            </div>
            {!capturing && (
              <Button onClick={() => void start()}><Camera />Photograph them</Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => { stop(); setFound(null); }}><X />Not them</Button>
          </div>
        )}

        {capturing && (
          <div className="space-y-3">
            <div className="relative overflow-hidden rounded-2xl bg-muted">
              <video ref={video} playsInline muted className="block max-h-80 w-full -scale-x-100 object-cover" />
              <div className="absolute inset-x-0 bottom-0 bg-foreground/60 px-3 py-2 text-center text-[12px] text-background">
                {samples.length} of {NEEDED} captured
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button loading={busy} onClick={() => void capture()} disabled={samples.length >= NEEDED}>
                <Camera />Capture
              </Button>
              {samples.length >= NEEDED && (
                <Button loading={busy} onClick={() => void save()}><Check />Save {found?.name?.split(" ")[0]}&apos;s face</Button>
              )}
              <Button variant="outline" onClick={stop}>Cancel</Button>
            </div>
          </div>
        )}

        {hint && <p className="text-[12.5px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

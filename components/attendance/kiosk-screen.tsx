"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadFaceModels, cameraSupported, FaceModelError } from "@/lib/face/client";
import { BlinkWatcher, blinkRatio, type Point } from "@/lib/face/liveness";
import { enqueue, flush, queuedCount, newRef } from "@/lib/face/door-queue";

/**
 * A tablet on a wall, taking attendance (A126).
 *
 * The whole screen is one loop: watch for a face, ask it to blink, capture,
 * send, say what happened, reset. Nobody taps anything, so every state has to
 * explain itself in a line somebody can read while walking up to it.
 *
 * The device token lives in this browser and nowhere else. It is entered once,
 * when the tablet is hung up, and it is the only thing that authorises any of
 * this - so the setup screen says plainly that it should be treated like a key.
 */

type Phase = "setup" | "starting" | "looking" | "blink" | "sending" | "done" | "held" | "unknown" | "failed";

const TOKEN_KEY = "workpulse.door.token";
/** How long a result stays on screen before the next person. */
const RESULT_MS = 3500;
/** How often frames are examined. Four a second is enough for a blink and gentle on a cheap tablet. */
const FRAME_MS = 250;

export function KioskScreen() {
  const [token, setToken] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("setup");
  const [message, setMessage] = useState("");
  const [person, setPerson] = useState<{ name: string; type: string; at: string } | null>(null);
  /*
   * How many swipes the device is holding (A128). Shown in the corner, because
   * a door quietly storing a day's attendance and a door working normally look
   * identical from in front of it - and somebody should be able to see that the
   * connection has been out without reading a log.
   */
  const [held, setHeld] = useState(0);

  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const watcher = useRef(new BlinkWatcher());
  const busy = useRef(false);
  const loopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TOKEN_KEY);
      if (saved) { setToken(saved); setPhase("starting"); }
    } catch { /* a locked-down browser: they can type it each time */ }
  }, []);

  /** Everything stops when this screen goes away - a camera left running at a door is a camera nobody knows about. */
  const stop = useCallback(() => {
    if (loopTimer.current) clearTimeout(loopTimer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const reset = useCallback(() => {
    watcher.current.reset();
    setPerson(null);
    setPhase("looking");
    setMessage("Step up to the camera");
  }, []);

  /* ---------- the loop ---------- */
  const tick = useCallback(async () => {
    if (busy.current || !video.current || !token) return;
    const api = await import("@vladmandic/face-api");

    const found = await api
      .detectSingleFace(video.current, new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 }))
      .withFaceLandmarks(true)
      .run()
      .catch(() => null);

    if (!found) {
      watcher.current.reset();
      setPhase("looking");
      setMessage("Step up to the camera");
      return;
    }

    const marks = found.landmarks;
    const ratio = blinkRatio(marks.getLeftEye() as Point[], marks.getRightEye() as Point[]);
    const live = watcher.current.push(ratio);

    if (live.state === "timeout") {
      watcher.current.reset();
      setMessage("Look at the camera and blink once");
      return;
    }
    if (live.state !== "alive") {
      setPhase("blink");
      setMessage(live.message);
      return;
    }

    /*
     * A live face. From here on nothing else is examined until this one has
     * been dealt with - without the latch, the frames arriving while the
     * request is in flight would send the same person three more times.
     */
    busy.current = true;
    setPhase("sending");
    setMessage("One moment");
    try {
      const descriptor = await api
        .computeFaceDescriptor(video.current)
        .then((d) => Array.from(d as Float32Array))
        .catch(() => null);

      const shot = document.createElement("canvas");
      shot.width = video.current.videoWidth || 640;
      shot.height = video.current.videoHeight || 480;
      shot.getContext("2d")?.drawImage(video.current, 0, 0, shot.width, shot.height);
      const blob = await new Promise<Blob | null>((done) => shot.toBlob(done, "image/jpeg", 0.85));

      const fd = new FormData();
      if (blob) fd.append("photo", new File([blob], "door.jpg", { type: "image/jpeg" }));
      fd.append("faceDescriptor", JSON.stringify(descriptor));
      fd.append("live", "true");

      let res: Response;
      try {
        res = await fetch("/api/kiosk/swipe", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: fd,
        });
      } catch {
        /*
         * No connection. The swipe is put by with the time the device saw, and
         * sent when the wifi comes back - a door that stops working means
         * people cannot clock in, which becomes an argument about pay.
         *
         * Nobody is named on this screen: without the server there is no way to
         * know who it was, and guessing at a name would be worse than saying
         * plainly that it was recorded and will be sent.
         */
        const kept = blob
          ? await enqueue({ ref: newRef(), takenAt: Date.now(), photo: blob, descriptor, live: true })
          : false;
        setHeld(await queuedCount());
        setPhase(kept ? "held" : "failed");
        setMessage(kept
          ? "Saved on this device - it will be sent when the connection is back"
          : "This device cannot store any more swipes. Tell HR.");
        return;
      }
      const json = await res.json().catch(() => null);

      if (res.status === 401) {
        setPhase("failed");
        setMessage("This tablet is no longer registered. Ask HR to set it up again.");
        return;
      }
      if (!res.ok) {
        setPhase("failed");
        setMessage(json?.error?.message ?? "Something went wrong. Try again.");
      } else if (json?.data?.recognised) {
        const d = json.data;
        setPerson({ name: d.name, type: d.type === "ON_DUTY" ? "on duty" : "off duty", at: d.at });
        setPhase("done");
        setMessage("");
      } else {
        // Not an error: a visitor, a delivery, somebody at an angle.
        setPhase("unknown");
        setMessage("Not recognised. Use your phone, or ask HR to enrol your face.");
      }
    } finally {
      setTimeout(() => { busy.current = false; reset(); }, RESULT_MS);
    }
  }, [token, reset]);

  /*
   * Anything held gets sent when the browser says the connection is back, and
   * on a slow timer besides - "online" is not always fired, and a router that
   * came back while the tablet was idle would otherwise leave a day's
   * attendance sitting on a wall.
   */
  useEffect(() => {
    if (!token || phase === "setup") return;
    let alive = true;

    const send = async () => {
      if (!alive) return;
      const { left } = await flush(token).catch(() => ({ sent: 0, left: 0 }));
      if (alive) setHeld(left);
    };

    void send();
    const timer = setInterval(() => void send(), 60_000);
    window.addEventListener("online", send);
    return () => { alive = false; clearInterval(timer); window.removeEventListener("online", send); };
  }, [token, phase]);

  /* ---------- start the camera once there is a token ---------- */
  useEffect(() => {
    if (!token || phase === "setup") return;
    let alive = true;

    (async () => {
      if (!cameraSupported()) { setPhase("failed"); setMessage("This tablet has no camera the browser can use."); return; }
      setPhase("starting");
      setMessage("Getting ready…");
      try {
        await loadFaceModels((pct) => {
          if (alive && pct < 1) setMessage(`Getting ready - ${Math.round(pct * 100)}%`);
        });
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: 640, height: 480 } });
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream.current = s;
        if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
        reset();

        const run = async () => {
          if (!alive) return;
          await tick().catch(() => {});
          loopTimer.current = setTimeout(run, FRAME_MS);
        };
        void run();
      } catch (e) {
        if (!alive) return;
        setPhase("failed");
        setMessage(e instanceof FaceModelError ? e.message : "The camera could not be opened.");
      }
    })();

    return () => { alive = false; stop(); };
  }, [token, phase === "setup", tick, reset, stop]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- setting it up, once ---------- */
  if (phase === "setup") {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-sidebar p-6 text-white">
        <div className="w-full max-w-md space-y-4">
          <h1 className="font-display text-[30px]">Set up this door</h1>
          <p className="text-[14px] text-white/70">
            Paste the code HR gave you when they registered this tablet. It is shown once, and it
            is the only thing that lets this screen record attendance - treat it like a key.
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Device code"
            aria-label="Device code"
            className="h-14 w-full rounded-2xl bg-white/10 px-5 text-[15px] outline-none ring-1 ring-white/20 focus:ring-white/60"
          />
          <button
            type="button"
            disabled={typed.trim().length < 10}
            onClick={() => {
              const t = typed.trim();
              try { localStorage.setItem(TOKEN_KEY, t); } catch { /* still works for this session */ }
              setToken(t);
              setPhase("starting");
            }}
            className="h-14 w-full rounded-full bg-success text-[16px] font-bold text-white disabled:opacity-40"
          >
            Start
          </button>
        </div>
      </main>
    );
  }

  const tone =
    phase === "done" ? "bg-success"
      : phase === "held" ? "bg-warning"
        : phase === "unknown" || phase === "failed" ? "bg-danger"
          : "bg-sidebar";

  return (
    <main className={`relative flex min-h-dvh flex-col items-center justify-center p-6 text-white transition-colors ${tone}`}>
      {/* Mirrored, because a preview that moves the wrong way makes people step the wrong way. */}
      <video ref={video} playsInline muted className="mb-6 h-64 w-64 rounded-full object-cover -scale-x-100 ring-4 ring-white/30" />

      {phase === "done" && person ? (
        <>
          <p className="font-display text-[46px] leading-none">{person.name}</p>
          <p className="mt-3 text-[20px] text-white/80">
            Swiped {person.type} at {new Date(person.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </p>
        </>
      ) : (
        <p className="max-w-xl text-center font-display text-[30px] leading-tight">{message}</p>
      )}

      {held > 0 && (
        // Small, in the corner: it is for whoever walks past, not for the
        // person swiping, who has already been told their swipe was kept.
        <p className="absolute bottom-4 right-5 text-[12.5px] text-white/50">
          {held} swipe{held === 1 ? "" : "s"} waiting to be sent
        </p>
      )}

      {phase === "blink" && (
        <p className="mt-4 text-[15px] text-white/60">A photograph cannot blink - this is how the door knows you are really here.</p>
      )}
    </main>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, LogIn, LogOut, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { useSwipe } from "./use-swipe";
import { Where } from "./swipe-sheet";

/**
 * The full swipe screen (A83, reshaped A88). Same order as the sheet the bottom bar opens: take
 * the photo, then say anything worth saying, then the one action that makes sense - Off duty if
 * you are already on, On duty if you are not. Never both.
 */
export function SwipeView() {
  const s = useSwipe(true);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const send = async () => {
    if (!photo) return;
    if (await s.submit(photo, note)) {
      setPhoto(null); setNote("");
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const label = s.nextType === "OFF_DUTY" ? "Off duty" : "On duty";
  const ready = Boolean(s.fix && photo) && s.nextType !== null && !s.sending;

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1"><Where s={s} /></div>
        <button type="button" onClick={s.locate} aria-label="Check my location again" className="mt-3 shrink-0 rounded-full p-2.5 text-muted-foreground hover:bg-muted">
          <RefreshCw className={cn("size-4", s.locating && "animate-spin")} />
        </button>
      </div>

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

      {photo && (
        <div>
          <label htmlFor="swipe-note-page" className="block text-[13px] font-semibold">Note <span className="font-normal text-muted-foreground">(optional)</span></label>
          <textarea id="swipe-note-page" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={s.inside ? "Anything worth recording" : "Why are you away from a work site?"}
            className="mt-1 w-full resize-none rounded-2xl bg-card px-4 py-3 text-sm outline-none ring-1 ring-border focus:ring-primary" />
        </div>
      )}

      <button type="button" disabled={!ready} onClick={() => void send()}
        className={cn("flex h-14 w-full items-center justify-center gap-2.5 rounded-full text-[15.5px] font-bold text-white",
          !ready ? "bg-muted-foreground/40" : s.nextType === "OFF_DUTY" ? "bg-sidebar" : "bg-success")}>
        {s.nextType === "OFF_DUTY" ? <LogOut className="size-5" /> : <LogIn className="size-5" />}
        {s.sending ? "Sending..." : s.nextType === null ? "Checking your last swipe..." : label}
      </button>

      {!ready && !s.sending && (
        <p className="text-center text-[12.5px] text-muted-foreground">
          {!s.fix ? "Waiting for your location" : !photo ? "Take a photo to swipe" : ""}
        </p>
      )}
    </div>
  );
}

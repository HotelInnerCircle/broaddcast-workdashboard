"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LogIn, LogOut, MapPin, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useSwipe } from "./use-swipe";

export interface SwipeSheetHandle { openCamera: () => void }

/**
 * Tap the Swipe button and the camera opens (A88) - no screen in between.
 *
 * The file input is clicked inside the same tap that opened it, which is what lets the browser
 * treat it as a real gesture; a click fired after a route change would be blocked. The sheet only
 * appears once a photo comes back, and then asks the one question left: a note, and the single
 * action that makes sense - Off duty if you are already on, On duty if you are not.
 */
export const SwipeSheet = forwardRef<SwipeSheetHandle>(function SwipeSheet(_props, ref) {
  const [armed, setArmed] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const s = useSwipe(armed);

  useImperativeHandle(ref, () => ({
    openCamera: () => {
      setArmed(true);           // starts the location fix and the duty lookup straight away
      fileRef.current?.click(); // same tap, so the camera is allowed to open
    },
  }), []);

  useEffect(() => {
    if (!photo) { setPreview(null); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const close = () => {
    setPhoto(null); setNote("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const send = async () => {
    if (!photo) return;
    if (await s.submit(photo, note)) close();
  };

  const label = s.nextType === "OFF_DUTY" ? "Off duty" : "On duty";
  const ready = Boolean(s.fix) && s.nextType !== null && !s.sending;

  return (
    <>
      <input
        ref={fileRef} type="file" accept="image/*" capture="user" className="hidden"
        onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
      />

      <DialogPrimitive.Root open={Boolean(photo)} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <DialogPrimitive.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92dvh] overflow-y-auto rounded-t-3xl bg-card p-5 pb-[max(20px,env(safe-area-inset-bottom))] shadow-float">
            <DialogPrimitive.Title className="text-[17px] font-semibold">Swipe {label.toLowerCase()}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-0.5 text-[12.5px] text-muted-foreground">
              The time and where you are are added to the photo automatically.
            </DialogPrimitive.Description>
            <DialogPrimitive.Close aria-label="Cancel" className="absolute right-4 top-4 rounded-full p-2 text-muted-foreground hover:bg-muted">
              <X className="size-4" />
            </DialogPrimitive.Close>

            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Your swipe photo" className="mt-4 h-48 w-full rounded-2xl object-cover" />
            )}

            <Where s={s} />

            <label htmlFor="swipe-note" className="mt-4 block text-[13px] font-semibold">Note <span className="font-normal text-muted-foreground">(optional)</span></label>
            <textarea
              id="swipe-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={s.inside ? "Anything worth recording" : "Why are you away from a work site?"}
              className="mt-1 w-full resize-none rounded-2xl bg-muted px-4 py-3 text-sm outline-none ring-1 ring-border focus:ring-primary"
            />

            <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="h-12 rounded-full px-4 text-[13.5px] font-semibold text-muted-foreground ring-1 ring-border">
                Retake
              </button>
              <button
                type="button" disabled={!ready} onClick={() => void send()}
                className={cn("flex h-12 items-center justify-center gap-2 rounded-full text-[15px] font-bold text-white",
                  !ready ? "bg-muted-foreground/40" : s.nextType === "OFF_DUTY" ? "bg-sidebar" : "bg-success")}
              >
                {s.nextType === "OFF_DUTY" ? <LogOut className="size-5" /> : <LogIn className="size-5" />}
                {s.sending ? "Sending..." : s.nextType === null ? "Checking..." : label}
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
});

/** One line saying where the person is, in the sheet where they are about to commit to it. */
export function Where({ s }: { s: ReturnType<typeof useSwipe> }) {
  const tone = s.locError ? "danger" : !s.fix ? "muted" : s.inside ? "success" : "warning";
  const fill = {
    success: "bg-success-soft text-tile-success-fg", warning: "bg-warning-soft text-tile-warning-fg",
    danger: "bg-danger-soft text-tile-danger-fg", muted: "bg-muted text-muted-foreground",
  }[tone];
  const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);
  return (
    <div className={cn("mt-3 flex items-start gap-2.5 rounded-2xl px-4 py-3", fill)}>
      <span className="mt-0.5 shrink-0">
        {s.locError ? <TriangleAlert className="size-[18px]" /> : s.inside ? <ShieldCheck className="size-[18px]" /> : <MapPin className="size-[18px]" />}
      </span>
      <p className="text-[12.5px] font-semibold leading-snug">
        {s.locError ? s.locError
          : s.locating || !s.fix ? "Finding where you are..."
          : s.sites.length === 0 ? "No work sites set up yet - this swipe will need approval"
          : s.inside ? `You are at ${s.nearest!.site.name}`
          : `${dist(s.nearest!.d)} from ${s.nearest!.site.name} - this swipe goes for approval`}
      </p>
    </div>
  );
}

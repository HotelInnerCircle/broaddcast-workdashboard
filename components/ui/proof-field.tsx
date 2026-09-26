"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, X, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * A picture of the work, attached to a timer stop or a daily report (A105).
 *
 * `capture="environment"` means a phone opens the camera rather than the photo
 * library, which is the point when the picture is meant to be of the work just
 * done. A laptop ignores it and shows a file picker, so the same control serves
 * both.
 *
 * The preview is a local object URL and is revoked when it changes, so choosing
 * six photos in a row does not leave six images held in memory.
 */
export function ProofField({
  value,
  onChange,
  required,
  label = "Picture of the work",
  hint,
}: {
  value: File | null;
  onChange: (f: File | null) => void;
  required?: boolean;
  label?: string;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!value) { setPreview(null); return; }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-semibold">
        {label}
        {required
          ? <span className="ml-1 font-normal text-danger">required</span>
          : <span className="ml-1 font-normal text-muted-foreground">optional</span>}
      </p>

      <input
        ref={input}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label={label}
        onChange={(e) => { onChange(e.target.files?.[0] ?? null); e.target.value = ""; }}
      />

      {preview ? (
        <div className="relative overflow-hidden rounded-xl ring-1 ring-border">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, never a remote one */}
          <img src={preview} alt="The picture you chose" className="block max-h-48 w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Remove the picture"
            className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-foreground/70 text-background hover:bg-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-5 text-sm transition-colors",
            required ? "border-danger/40 text-danger hover:bg-danger-soft/40" : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          <Camera className="size-4" />
          Take or choose a picture
        </button>
      )}

      {value && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <ImageIcon className="size-3.5" />{value.name} ({Math.max(1, Math.round(value.size / 1024))} KB)
        </p>
      )}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

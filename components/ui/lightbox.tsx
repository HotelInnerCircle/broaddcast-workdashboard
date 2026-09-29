"use client";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A picture, full size, over the page it was opened from (A119).
 *
 * Moved here out of the chat attachments it was written for, because a second
 * place now needs it: the time report shows the photograph attached to a
 * session, and opening that in a new browser tab threw the person out of the
 * report they were reading to look at one image. Two viewers that behave
 * differently is worse than one that moved.
 *
 * Takes the least it needs - a name, a URL, and something to download - so
 * anything with a picture can use it without inventing a chat attachment.
 */
export interface LightboxImage { name: string; url: string; downloadUrl?: string }

export function Lightbox({ images, index, onClose }: { images: LightboxImage[]; index: number; onClose: () => void }) {
  const [i, setI] = useState(index);
  useEffect(() => setI(index), [index]);
  const step = useCallback((d: number) => setI((n) => (n + d + images.length) % images.length), [images.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") step(1); if (e.key === "ArrowLeft") step(-1); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, step]);
  const img = images[i];
  if (!img) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-foreground/92 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={img.name}>
      <div className="flex items-center gap-2 p-3 text-background">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{img.name}</span>
        <span className="shrink-0 text-xs opacity-70">{images.length > 1 && `${i + 1} / ${images.length}`}</span>
        {img.downloadUrl && (
          <a href={img.downloadUrl} download className="rounded-lg p-2 hover:bg-background/15" aria-label="Download"><Download className="size-5" /></a>
        )}
        <button onClick={onClose} className="rounded-lg p-2 hover:bg-background/15" aria-label="Close"><X className="size-5" /></button>
      </div>
      <button className="flex min-h-0 flex-1 cursor-zoom-out items-center justify-center p-4" onClick={onClose} aria-label="Close">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt={img.name} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      </button>
      {images.length > 1 && (
        <div className="flex items-center justify-center gap-3 p-3">
          <Button variant="ghost" size="icon" className="text-background hover:bg-background/15" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft /></Button>
          <Button variant="ghost" size="icon" className="text-background hover:bg-background/15" onClick={() => step(1)} aria-label="Next"><ChevronRight /></Button>
        </div>
      )}
    </div>
  );
}

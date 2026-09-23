"use client";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, Presentation, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export interface Attachment { id: string; name: string; size: number; mime: string; width: number | null; height: number | null; url: string; downloadUrl: string }

export const isImage = (a: { mime: string }) => a.mime.startsWith("image/");

/** 1.2 KB / 3.4 MB - the size people actually read. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DOC_ICONS: { test: RegExp; icon: typeof FileText; tint: string }[] = [
  { test: /pdf/, icon: FileText, tint: "bg-danger-soft text-danger" },
  { test: /spreadsheet|excel|csv/, icon: FileSpreadsheet, tint: "bg-success-soft text-success" },
  { test: /presentation|powerpoint/, icon: Presentation, tint: "bg-warning-soft text-warning" },
];
export const docLook = (mime: string) => DOC_ICONS.find((d) => d.test.test(mime)) ?? { icon: FileText, tint: "bg-info-soft text-info" };
export const fileKind = (mime: string) => (isImage({ mime }) ? "Image" : /pdf/.test(mime) ? "PDF" : /spreadsheet|excel/.test(mime) ? "Spreadsheet" : /presentation/.test(mime) ? "Presentation" : /word|document/.test(mime) ? "Document" : "File");

/**
 * Document card inside a bubble (A72): icon, name, type and size, with its own download button so a
 * file can be saved without opening it first.
 */
export function DocumentCard({ file, mine }: { file: Attachment; mine: boolean }) {
  const { icon: Icon, tint } = docLook(file.mime);
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl p-2", mine ? "bg-foreground/10" : "bg-muted")}>
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tint)}><Icon className="size-4.5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-tight">{file.name}</span>
        <span className="block text-[11px] opacity-70">{fileKind(file.mime)} &middot; {fileSize(file.size)}</span>
      </span>
      <a href={file.downloadUrl} download className={cn("shrink-0 rounded-lg p-1.5 transition-colors", mine ? "hover:bg-foreground/10" : "hover:bg-border")} aria-label={`Download ${file.name}`} title="Download"><Download className="size-4" /></a>
    </div>
  );
}

/**
 * Image gallery (A72). One image keeps its own shape; two or more tile into a WhatsApp-style grid
 * where a fourth tile counts the rest. Tapping any of them opens the lightbox at that picture.
 */
export function ImageGallery({ images, onOpen }: { images: Attachment[]; onOpen: (index: number) => void }) {
  if (images.length === 0) return null;
  if (images.length === 1) {
    const img = images[0];
    const ratio = img.width && img.height ? img.width / img.height : 1;
    return (
      <button type="button" onClick={() => onOpen(0)} className="block overflow-hidden rounded-xl" aria-label={`Open ${img.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt={img.name} loading="lazy" style={{ aspectRatio: ratio }} className={cn("w-full object-cover", ratio > 1.6 ? "max-h-52" : "max-h-72", "max-w-[min(18rem,60vw)]")} />
      </button>
    );
  }
  const shown = images.slice(0, 4);
  const extra = images.length - shown.length;
  return (
    <div className={cn("grid w-[min(18rem,62vw)] gap-1 overflow-hidden rounded-xl", images.length === 2 ? "grid-cols-2" : "grid-cols-2")}>
      {shown.map((img, i) => (
        <button key={img.id} type="button" onClick={() => onOpen(i)} className={cn("relative overflow-hidden bg-muted", images.length === 3 && i === 0 && "col-span-2")} aria-label={`Open ${img.name}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.url} alt={img.name} loading="lazy" className={cn("w-full object-cover", images.length === 3 && i === 0 ? "h-32" : "h-24")} />
          {extra > 0 && i === shown.length - 1 && <span className="absolute inset-0 flex items-center justify-center bg-foreground/55 text-lg font-semibold text-background">+{extra}</span>}
        </button>
      ))}
    </div>
  );
}

/** Full-screen viewer: arrow keys and Escape work, and the current picture can be downloaded. */
export function Lightbox({ images, index, onClose }: { images: Attachment[]; index: number; onClose: () => void }) {
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
        <a href={img.downloadUrl} download className="rounded-lg p-2 hover:bg-background/15" aria-label="Download"><Download className="size-5" /></a>
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

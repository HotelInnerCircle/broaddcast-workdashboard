"use client";
import { Download, FileSpreadsheet, FileText, Presentation } from "lucide-react";
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

/*
 * The viewer moved to components/ui/lightbox (A119): the time report needs it
 * too, and a picture opened from a report should not throw somebody into a new
 * browser tab. Re-exported here so nothing that already imports it breaks.
 */
export { Lightbox, type LightboxImage } from "@/components/ui/lightbox";

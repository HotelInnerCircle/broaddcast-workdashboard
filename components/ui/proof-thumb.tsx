"use client";

import { useEffect, useState } from "react";
import { Lightbox, type LightboxImage } from "@/components/ui/lightbox";

/**
 * The picture attached to a piece of work, small (A135).
 *
 * Written for the time report and now wanted on the timer screen too, so it
 * lives here rather than being copied - a second one would drift, and a
 * photograph should behave the same way wherever it appears.
 *
 * The link is fetched when the thumbnail mounts rather than with the page: it
 * is signed and short-lived, and a timesheet of two thousand rows would
 * otherwise mint two thousand URLs nobody opens.
 */
export function ProofThumb({
  entryId, kind = "timer", label, size = "md", onOpen,
}: {
  entryId: string;
  /** Which kind of record holds it - a timer entry or a daily report. */
  kind?: "timer" | "daily";
  label: string;
  size?: "sm" | "md";
  /** When given, opening is the parent's business; otherwise this handles it. */
  onOpen?: (img: LightboxImage) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [own, setOwn] = useState<LightboxImage | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/work-proof/${kind}/${entryId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (alive) setUrl(j?.data?.url ?? null); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [entryId, kind]);

  const box = size === "sm" ? "h-10 w-14" : "h-14 w-20";

  if (failed) return <span className="text-[11px] text-muted-foreground">Picture unavailable</span>;
  if (!url) return <span className={`block ${box} animate-pulse rounded-md bg-muted`} />;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const img = { name: label, url, downloadUrl: url };
          if (onOpen) onOpen(img); else setOwn(img);
        }}
        title="See the full picture"
        className="block rounded-md ring-1 ring-border transition-opacity hover:opacity-80"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a signed storage URL that expires */}
        <img src={url} alt="Picture of the work" className={`${box} rounded-md object-cover`} />
      </button>
      {/* Over the page, never a new tab - the same viewer everything else uses. */}
      {own && <Lightbox images={[own]} index={0} onClose={() => setOwn(null)} />}
    </>
  );
}

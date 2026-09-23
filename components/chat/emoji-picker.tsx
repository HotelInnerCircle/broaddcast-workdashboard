"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, Search, Smile, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";

/** [character, display name, search words] */
type Emoji = [string, string, string];
interface Catalogue { groups: { label: string; emoji: Emoji[] }[] }

const RECENT_KEY = "wp.chat.recentEmoji";
const RECENT_MAX = 32;

function readRecent(): string[] {
  try { const raw = localStorage.getItem(RECENT_KEY); return raw ? (JSON.parse(raw) as string[]).slice(0, RECENT_MAX) : []; } catch { return []; }
}
export function rememberEmoji(char: string) {
  try {
    const next = [char, ...readRecent().filter((e) => e !== char)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private window - recents are a convenience, not state we rely on */ }
}

/**
 * Full emoji picker (A73): the whole Unicode set in the nine categories WhatsApp shows, with
 * search by name and a "Recent" tab. The catalogue is a generated JSON file loaded on first open
 * (`scripts/build-emoji.mjs`), so nothing emoji-related sits in the main bundle.
 */
export function EmojiPicker({ onPick, onClose, className }: { onPick: (char: string) => void; onClose: () => void; className?: string }) {
  const [data, setData] = useState<Catalogue | null>(null);
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setRecent(readRecent()); }, []);
  useEffect(() => { let live = true; import("@/lib/emoji-data.json").then((m) => { if (live) setData((m.default ?? m) as Catalogue); }); return () => { live = false; }; }, []);
  // Close on Escape or a click outside, like the other popovers on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  }, [onClose]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [tab, q]);

  const needle = q.trim().toLowerCase();
  const results = useMemo(() => {
    if (!data || !needle) return null;
    const hits: Emoji[] = [];
    for (const g of data.groups) for (const e of g.emoji) { if (e[2].includes(needle)) { hits.push(e); if (hits.length >= 180) return hits; } }
    return hits;
  }, [data, needle]);

  const pick = (char: string) => { rememberEmoji(char); setRecent((r) => [char, ...r.filter((e) => e !== char)].slice(0, RECENT_MAX)); onPick(char); };
  const tabs = data ? [{ label: "Recent", icon: true }, ...data.groups.map((g) => ({ label: g.label, icon: false }))] : [];
  const shown: Emoji[] = results ?? (!data ? [] : tab === 0 ? recent.map((c) => [c, c, c] as Emoji) : data.groups[tab - 1].emoji);

  return (
    <div ref={rootRef} className={cn("z-30 flex h-80 w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl bg-card shadow-float ring-1 ring-border/60", className)} role="dialog" aria-label="Emoji picker">
      <div className="flex items-center gap-1 border-b border-border p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search emoji" aria-label="Search emoji" className="h-8 rounded-full pl-8 text-sm" autoFocus />
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label="Close emoji picker"><X className="size-4" /></button>
      </div>

      {!results && (
        <div className="flex gap-0.5 overflow-x-auto border-b border-border px-1.5 py-1 scrollbar-none">
          {tabs.map((t, i) => (
            <button key={t.label} onClick={() => setTab(i)} title={t.label} aria-label={t.label} aria-pressed={tab === i}
              className={cn("shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-semibold transition-colors", tab === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {t.icon ? <Clock className="size-3.5" /> : t.label}
            </button>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!data ? (
          <p className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Smile className="size-4" />Loading emoji...</p>
        ) : shown.length === 0 ? (
          <p className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">{results ? "No emoji match." : "Emoji you use will show up here."}</p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {shown.map((e, i) => (
              <button key={`${e[0]}-${i}`} onClick={() => pick(e[0])} title={e[1]} aria-label={e[1]} className="flex aspect-square items-center justify-center rounded-lg text-[22px] leading-none transition-colors hover:bg-muted">
                {e[0]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

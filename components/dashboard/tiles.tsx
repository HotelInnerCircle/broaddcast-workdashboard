"use client";
import Link from "next/link";
import {
  BarChart3, Building2, CalendarCheck, CalendarDays, FileText, FolderKanban, ListChecks,
  MessageSquare, Settings, Table2, Timer, Users, UsersRound,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { navigationFor } from "@/config/navigation";
import { cn } from "@/lib/utils/cn";
import type { Role } from "@/types";

/**
 * Tiles name their icon rather than carrying the component (A81). A Lucide icon is a function, and
 * a function cannot be passed from a server component to a client one - doing so is what produced
 * the "Functions cannot be passed directly to Client Components" error in A69.
 */
export const TILE_ICONS = {
  tasks: ListChecks, timer: Timer, timesheets: Table2, attendance: CalendarCheck,
  report: FileText, chat: MessageSquare, projects: FolderKanban, calendar: CalendarDays,
  reports: BarChart3, people: Users, teams: UsersRound, clients: Building2, settings: Settings,
} as const;
export type TileIcon = keyof typeof TILE_ICONS;

/**
 * One launcher tile. `tone` groups it by family rather than decorating it: green is time, brown is
 * work, blue is admin - so the grid stays readable at a glance instead of being a rainbow. Every
 * fill is dark enough to carry white text and icons.
 */
export interface LauncherTile {
  href: string;
  label: string;
  icon: TileIcon;
  tone: "time" | "time-2" | "time-3" | "work" | "work-2" | "work-3" | "admin" | "admin-2" | "muted";
  /** A count worth interrupting for, or `true` for a bare "needs attention" dot. */
  badge?: number | true;
  /** Desktop only: the small line under the label. */
  hint?: string;
}

export const TILE_FILL: Record<LauncherTile["tone"], string> = {
  time: "bg-[#2f6b3a]",
  "time-2": "bg-[#3f8a4c]",
  "time-3": "bg-[#245a30]",
  work: "bg-[#8a5a3c]",
  "work-2": "bg-[#a5734f]",
  "work-3": "bg-[#6b4229]",
  admin: "bg-[#4f5d7a]",
  "admin-2": "bg-[#3f4c66]",
  muted: "bg-[#8f877a]",
};

/**
 * Drops tiles the person cannot reach. A tile pointing at a page the sidebar hides (A71), or that
 * their role has no permission for, must not sit on the home screen either - otherwise "Menu
 * visibility" would hide a link and leave a shortcut to the same place.
 */
export function visibleTiles(role: Role, hidden: string[], tiles: LauncherTile[]): LauncherTile[] {
  const allowed = new Set(navigationFor(role, hidden).flatMap((g) => g.items.map((i) => i.href.split("?")[0])));
  return tiles.filter((t) => allowed.has(t.href.split("?")[0]));
}

export function TileBadge({ badge }: { badge: LauncherTile["badge"] }) {
  if (badge === true) return <span className="absolute -right-0.5 -top-0.5 size-4 rounded-full bg-warning ring-2 ring-card" />;
  if (typeof badge === "number" && badge > 0) {
    return (
      <span className="absolute -right-1 -top-1 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-card">
        {badge > 99 ? "99+" : badge}
      </span>
    );
  }
  return null;
}

/** The same tiles on desktop, laid out as wide cards under the timer hero (A81). */
export function QuickTiles({ tiles, className }: { tiles: LauncherTile[]; className?: string }) {
  const me = useAuth();
  // The same filter the phone grid uses: a tile must never outlive the nav entry it shortcuts.
  const shown = visibleTiles(me.role, me.company?.hiddenNav ?? [], tiles);
  if (shown.length === 0) return null;
  return (
    <div className={cn("hidden gap-3 md:grid md:grid-cols-3 2xl:grid-cols-6", className)}>
      {shown.map((t) => {
        const Icon = TILE_ICONS[t.icon];
        return (
          <Link key={t.href + t.label} href={t.href} className="flex items-center gap-3.5 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border/50 transition-colors hover:bg-muted/50">
            <span className={cn("relative flex size-[42px] shrink-0 items-center justify-center rounded-full text-white", TILE_FILL[t.tone])}>
              <Icon className="size-5" strokeWidth={2} />
              <TileBadge badge={t.badge} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold">{t.label}</span>
              {t.hint && <span className="block truncate text-[11.5px] text-muted-foreground">{t.hint}</span>}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

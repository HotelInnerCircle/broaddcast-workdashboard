"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Timer, MessageSquare, User, Fingerprint } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useAuth } from "@/hooks/useAuth";
import { useTimerOptional } from "@/hooks/useTimer";
import { useRealtimeOptional } from "@/hooks/useRealtime";
import { ROLE_HOME } from "@/types";

/**
 * Bottom navigation for phones ("Ribbon" direction, A66): a light rounded bar with a raised centre
 * button. That button is the **swipe** (A85) - the thing most people open the app to do, and the
 * one action worth a thumb-tap from anywhere. Timer keeps a tab of its own, tinted while it runs,
 * so the running state is still visible at a glance.
 * Order: Home, Timer, [Swipe], Chat, Profile. Tabs the admin has hidden for this role (A71) drop
 * out of the bar, and the grid narrows to match.
 */
export function MobileBottomNav({ onSwipe }: { onSwipe: () => void }) {
  const me = useAuth();
  const pathname = usePathname();
  const { entry, break: onBreak, unread } = useBottomNavState();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const hidden = me.company?.hiddenNav ?? [];
  const running = entry?.status === "RUNNING" || onBreak;
  const side = [
    { label: "Home", href: ROLE_HOME[me.role], icon: Home },
    { label: "Timer", href: "/timer", icon: Timer, running },
    { label: "Chat", href: "/chat", icon: MessageSquare, badge: unread },
    // A89: a page, not a drawer - back works and the browser remembers where you were.
    { label: "Profile", href: "/profile", icon: User },
  ].filter((i) => !i.href || !hidden.includes(i.href));
  const showSwipe = !hidden.includes("/swipe");
  const left = Math.floor(side.length / 2);
  const columns = side.length + (showSwipe ? 1 : 0);
  const swipeActive = isActive("/swipe");

  return (
    <nav style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      className="fixed inset-x-0 bottom-0 z-30 grid items-end rounded-t-[26px] bg-card px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-10px_30px_-22px_rgb(42_38_32/0.7)] ring-1 ring-border/60 md:hidden">
      {side.slice(0, left).map((i) => <NavTab key={i.label} {...i} active={isActive(i.href!)} />)}

      {/* A88: this opens the camera in the same tap, rather than navigating to a screen first. */}
      {showSwipe && (
      <button type="button" onClick={onSwipe} aria-label="Swipe attendance" className="flex flex-col items-center gap-1">
        <span className={cn("-mt-7 flex size-14 items-center justify-center rounded-full border-4 border-card shadow-[0_10px_22px_-10px_rgb(42_38_32/0.55)] transition-colors", swipeActive ? "bg-foreground text-background" : "bg-primary text-primary-foreground")}>
          <Fingerprint className="size-6" strokeWidth={2.2} />
        </span>
        <span className={cn("text-[10px] font-bold", swipeActive ? "text-foreground" : "text-muted-foreground")}>Swipe</span>
      </button>
      )}

      {side.slice(left).map((i) => <NavTab key={i.label} {...i} active={isActive(i.href!)} />)}
    </nav>
  );
}

function NavTab({ label, href, icon: Icon, active, badge, running }: { label: string; href?: string | null; icon: typeof Home; active: boolean; badge?: number; running?: boolean }) {
  return (
    <Link href={href ?? "#"} className={cn("relative flex flex-col items-center gap-1 py-1 text-[10px] font-bold", running ? "text-success" : active ? "text-foreground" : "text-muted-foreground")}>
      <span className="relative">
        <Icon className="size-[19px]" strokeWidth={active ? 2.3 : 2} />
        {Boolean(badge) && <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">{badge! > 9 ? "9+" : badge}</span>}
      </span>
      {label}
    </Link>
  );
}

/** Timer/unread state for the bar; null-safe outside the providers (the Super Admin shell has neither). */
function useBottomNavState() {
  const t = useTimerOptional();
  const rt = useRealtimeOptional();
  return { entry: t?.entry ?? null, break: Boolean(t?.break), unread: rt?.unreadNotifications ?? 0 };
}


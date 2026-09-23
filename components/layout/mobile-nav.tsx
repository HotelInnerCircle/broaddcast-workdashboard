"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ListChecks, Timer, MessageSquare, User } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils/cn";
import { useAuth } from "@/hooks/useAuth";
import { useTimerOptional } from "@/hooks/useTimer";
import { useRealtimeOptional } from "@/hooks/useRealtime";
import { ROLE_HOME } from "@/types";
import { SidebarNav } from "./sidebar";
import { BrandMark } from "./brand-mark";

/**
 * Bottom navigation for phones ("Ribbon" direction, A66): a light rounded bar with the Timer as a
 * raised centre button, so starting or stopping time is one thumb-tap from anywhere.
 * Order: Home, Tasks, [Timer], Chat, Profile. Tabs the admin has hidden for this role (A71) drop
 * out of the bar, and the grid narrows to match.
 */
export function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const me = useAuth();
  const pathname = usePathname();
  const { entry, break: onBreak, unread } = useBottomNavState();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const hidden = me.company?.hiddenNav ?? [];
  const side = [
    { label: "Home", href: ROLE_HOME[me.role], icon: Home },
    { label: "Tasks", href: "/tasks", icon: ListChecks },
    { label: "Chat", href: "/chat", icon: MessageSquare, badge: unread },
    { label: "Profile", href: null, icon: User },
  ].filter((i) => !i.href || !hidden.includes(i.href));
  const showTimer = !hidden.includes("/timer");
  const left = Math.floor(side.length / 2);
  const columns = side.length + (showTimer ? 1 : 0);
  const timerActive = isActive("/timer");
  const running = entry?.status === "RUNNING" || onBreak;

  return (
    <nav style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      className="fixed inset-x-0 bottom-0 z-30 grid items-end rounded-t-[26px] bg-card px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-2.5 shadow-[0_-10px_30px_-22px_rgb(42_38_32/0.7)] ring-1 ring-border/60 md:hidden">
      {side.slice(0, left).map((i) => <NavTab key={i.label} {...i} active={isActive(i.href!)} />)}

      {showTimer && (
      <Link href="/timer" aria-label="Timer" className="flex flex-col items-center gap-1">
        <span className={cn("-mt-7 flex size-14 items-center justify-center rounded-full border-4 border-card shadow-[0_10px_22px_-10px_rgb(42_38_32/0.55)] transition-colors", running ? "bg-success text-white" : timerActive ? "bg-foreground text-background" : "bg-primary text-primary-foreground")}>
          <Timer className="size-6" strokeWidth={2.2} />
        </span>
        <span className={cn("text-[10px] font-bold", timerActive || running ? "text-foreground" : "text-muted-foreground")}>Timer</span>
      </Link>
      )}

      {side.slice(left).map((i) => (
        i.href
          ? <NavTab key={i.label} {...i} active={isActive(i.href)} />
          : <button key={i.label} type="button" onClick={onMore} aria-label="Profile and menu" className={cn("flex flex-col items-center gap-1 py-1 text-[10px] font-bold", pathname.startsWith("/settings") || pathname.startsWith("/notifications") ? "text-foreground" : "text-muted-foreground")}><i.icon className="size-[19px]" strokeWidth={2} />{i.label}</button>
      ))}
    </nav>
  );
}

function NavTab({ label, href, icon: Icon, active, badge }: { label: string; href?: string | null; icon: typeof Home; active: boolean; badge?: number }) {
  return (
    <Link href={href ?? "#"} className={cn("relative flex flex-col items-center gap-1 py-1 text-[10px] font-bold", active ? "text-foreground" : "text-muted-foreground")}>
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

export function MobileDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const me = useAuth();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40 md:hidden" />
        <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar text-sidebar-foreground shadow-xl md:hidden">
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Main navigation</DialogPrimitive.Description>
          <div className="flex h-16 items-center px-4"><BrandMark wide companyName={me.company?.name} companyLogoUrl={me.company?.logoUrl} className="w-full text-white" /></div>
          <SidebarNav collapsed={false} onNavigate={() => onOpenChange(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

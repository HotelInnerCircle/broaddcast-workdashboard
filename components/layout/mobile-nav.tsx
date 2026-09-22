"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ListChecks, Timer, MessageSquare, MoreHorizontal } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils/cn";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_HOME } from "@/types";
import { SidebarNav } from "./sidebar";
import { BrandMark } from "./brand-mark";

/** Bottom navigation for phones (spec section 11): Home, Tasks, Timer, Chat, More. */
export function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const me = useAuth();
  const pathname = usePathname();
  const items = [
    { label: "Home", href: ROLE_HOME[me.role], icon: Home },
    { label: "Tasks", href: "/tasks", icon: ListChecks, soon: false },
    { label: "Timer", href: "/timer", icon: Timer, soon: false },
    { label: "Chat", href: "/chat", icon: MessageSquare, soon: false },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 rounded-t-2xl bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground shadow-float md:hidden">
      {items.map((i) => {
        const active = pathname.startsWith(i.href);
        return (
          <Link key={i.label} href={i.soon ? "#" : i.href} onClick={(e) => i.soon && e.preventDefault()} className={cn("flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium", active ? "text-white" : "text-sidebar-foreground", i.soon && "opacity-50")}>
            <i.icon className="size-5" />{i.label}
          </Link>
        );
      })}
      <button onClick={onMore} className="flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-sidebar-foreground"><MoreHorizontal className="size-5" />More</button>
    </nav>
  );
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

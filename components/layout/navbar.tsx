"use client";
import { Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "./notification-bell";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";

export function Navbar({ onMenu }: { onMenu: () => void }) {
  const me = useAuth();
  const openSearch = () => window.dispatchEvent(new CustomEvent("wp:open-search"));
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 bg-background/85 px-4 backdrop-blur md:top-4 md:h-14 md:rounded-2xl md:px-2">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenu} aria-label="Open navigation"><Menu /></Button>
      <button
        type="button"
        onClick={openSearch}
        className="hidden h-11 w-full max-w-md items-center gap-2.5 rounded-full bg-card px-4 text-sm text-muted-foreground shadow-card transition-colors hover:text-foreground md:flex"
        aria-label="Global search"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search employees, clients, projects...</span>
        <kbd className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold">Ctrl K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={openSearch} aria-label="Search"><Search /></Button>
        {me.companyId && <NotificationBell />}
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

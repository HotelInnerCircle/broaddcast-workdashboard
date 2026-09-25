"use client";
import { useEffect, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/hooks/useAuth";
import type { SessionContext } from "@/types";
import { Sidebar } from "./sidebar";
import { Navbar } from "./navbar";
import { MobileBottomNav } from "./mobile-nav";
import { TimerProvider } from "@/hooks/useTimer";
import { RealtimeProvider } from "@/hooks/useRealtime";
import { CommandPalette } from "./command-palette";
import { MiniTimer } from "@/components/timer/mini-timer";
import { SwipeSheet, type SwipeSheetHandle } from "@/components/attendance/swipe-sheet";

export function AppShell({ session, children }: { session: SessionContext; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(true);
  const swipe = useRef<SwipeSheetHandle>(null);
  useEffect(() => { try { setCollapsed(localStorage.getItem("wp.sidebar") !== "0"); } catch {} }, []);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem("wp.sidebar", c ? "0" : "1"); } catch {} return !c; });

  const hasTimer = Boolean(session.companyId);
  const shell = (
    <TooltipProvider>
      <div className="flex min-h-dvh gap-4 p-0 md:p-4">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Navbar />
          {hasTimer && <MiniTimer />}
          <main className="flex-1 px-4 py-5 pb-32 md:px-6 md:pb-6 lg:px-8">
            <div className="mx-auto w-full max-w-7xl animate-in">{children}</div>
          </main>
        </div>
      </div>
      <MobileBottomNav onSwipe={() => swipe.current?.openCamera()} />
      {hasTimer && <SwipeSheet ref={swipe} />}
      {hasTimer && <CommandPalette />}
    </TooltipProvider>
  );
  return <SessionProvider value={session}>{hasTimer ? <RealtimeProvider><TimerProvider>{shell}</TimerProvider></RealtimeProvider> : shell}</SessionProvider>;
}

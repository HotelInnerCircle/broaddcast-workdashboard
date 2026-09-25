"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { ChevronRight, LogOut, Settings, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { navigationFor } from "@/config/navigation";
import { unregisterPushDevice } from "@/lib/native";
import { Avatar } from "@/components/ui/avatar";
import { ThemeToggle } from "./theme-toggle";
import { api } from "@/lib/api/client";
import { ProfileDetails, type Profile, type ReportingItem } from "@/components/profile/profile-details";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABEL } from "@/types";

/**
 * The phone's menu, as a page (A89).
 *
 * It used to be a drawer that slid in over whatever you were looking at. A drawer is a thing to
 * dismiss; this is a place you can be, which means back works, the browser remembers it, and a
 * link to it can be shared. Everything the sidebar holds on desktop lives here on a phone.
 */
export function ProfileView() {
  const me = useAuth();
  const router = useRouter();
  const groups = navigationFor(me.role, me.company?.hiddenNav ?? []);
  const [data, setData] = useState<{ profile: Profile; reporting: ReportingItem[] } | null>(null);

  const load = useCallback(() => {
    void api<{ profile: Profile; reporting: ReportingItem[] }>("/api/me/profile", { fresh: true })
      .then(setData)
      .catch(() => setData(null));
  }, []);
  useEffect(load, [load]);

  const leave = async () => {
    await unregisterPushDevice();
    await signOut({ redirect: false });
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="mx-auto w-full max-w-lg space-y-5 pb-4">
      {data
        ? <ProfileDetails profile={data.profile} reporting={data.reporting} onChanged={load} />
        : (
          <div className="space-y-3">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </div>
        )}

      <div className="flex items-center justify-between rounded-2xl bg-card px-4 py-3 shadow-card ring-1 ring-border/50">
        <span className="text-[14px] font-medium">Appearance</span>
        <ThemeToggle />
      </div>

      {groups.map((g) => (
        <section key={g.label}>
          <h2 className="mb-1.5 px-1 text-[11px] font-bold tracking-wide text-muted-foreground">{g.label}</h2>
          <ul className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border/50">
            {g.items.map((i) => (
              <li key={i.href} className="border-b border-border last:border-0">
                <Link href={i.href} className="flex items-center gap-3 px-4 py-3.5">
                  <i.icon className="size-[18px] shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{i.label}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <h2 className="mb-1.5 px-1 text-[11px] font-bold tracking-wide text-muted-foreground">ACCOUNT</h2>
        <ul className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border/50">
          <li className="border-b border-border">
            <Link href="/settings?tab=profile" className="flex items-center gap-3 px-4 py-3.5">
              <User className="size-[18px] shrink-0 text-muted-foreground" />
              <span className="flex-1 text-[14px] font-medium">My profile</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Link>
          </li>
          {me.role === "COMPANY_ADMIN" && (
            <li className="border-b border-border">
              <Link href="/settings" className="flex items-center gap-3 px-4 py-3.5">
                <Settings className="size-[18px] shrink-0 text-muted-foreground" />
                <span className="flex-1 text-[14px] font-medium">Company settings</span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          )}
          <li>
            <button type="button" onClick={() => void leave()} className="flex w-full items-center gap-3 px-4 py-3.5 text-danger">
              <LogOut className="size-[18px] shrink-0" />
              <span className="flex-1 text-left text-[14px] font-semibold">Sign out</span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  );
}

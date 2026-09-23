"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogOut, Settings, User } from "lucide-react";
import { signOut } from "next-auth/react";
import { unregisterPushDevice } from "@/lib/native";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABEL } from "@/types";

export function UserMenu() {
  const me = useAuth();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full outline-none ring-ring focus-visible:ring-2" aria-label="Open profile menu">
        <Avatar name={me.name} src={me.avatarUrl ?? me.company?.logoUrl ?? null} fit={me.avatarUrl ? "cover" : "contain"} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">{me.name}</span>
          <span className="truncate text-xs font-normal">{me.email}</span>
          <Badge variant="primary" className="mt-1 w-fit">{ROLE_LABEL[me.role]}</Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><Link href="/settings?tab=profile"><User />My profile</Link></DropdownMenuItem>
        {me.can("companySettings", "view") && (
          <DropdownMenuItem asChild><Link href="/settings"><Settings />Company settings</Link></DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={async () => { await unregisterPushDevice(); await signOut({ redirect: false }); router.push("/login"); router.refresh(); }}>
          <LogOut />Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { navigationFor } from "@/config/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Tooltip } from "@/components/ui/tooltip";
import { BrandMark } from "./brand-mark";

/**
 * Dark rail navigation ("Bento" direction). Collapsed = icon rail with tiny labels under each icon;
 * expanded = icon + full label. Groups are separated by hairlines in the rail and by captions when expanded.
 */
export function SidebarNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const me = useAuth();
  const pathname = usePathname();
  const groups = navigationFor(me.role);
  return (
    <nav className={cn("flex-1 overflow-y-auto scrollbar-none", collapsed ? "space-y-1 px-2 py-2" : "space-y-4 px-3 py-3")}>
      {groups.map((group, gi) => (
        <div key={group.label}>
          {collapsed ? (
            gi > 0 && <div className="mx-3 mb-1 h-px bg-white/10" />
          ) : (
            <p className="mb-1.5 px-2.5 text-[10px] font-semibold tracking-[0.14em] text-sidebar-foreground/60">{group.label}</p>
          )}
          <ul className={cn(collapsed ? "space-y-0.5" : "space-y-0.5")}>
            {group.items.map((item) => {
              const base = item.href.split("?")[0].split("#")[0];
              const active = pathname === base || (base !== "/" && pathname.startsWith(base + "/"));
              const soon = item.phase && item.phase > 1;
              const content = (
                <Link
                  href={soon ? "#" : item.href}
                  onClick={(e) => { if (soon) e.preventDefault(); else onNavigate?.(); }}
                  aria-disabled={soon || undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center rounded-xl text-sidebar-foreground transition-colors hover:bg-white/6 hover:text-white",
                    collapsed ? "flex-col gap-1 px-1 py-2 text-[9.5px] font-semibold leading-none" : "gap-3 px-2.5 py-2 text-sm font-medium",
                    active && "bg-sidebar-active text-white",
                    soon && "cursor-default opacity-40 hover:bg-transparent hover:text-sidebar-foreground",
                  )}
                >
                  <item.icon className={cn("shrink-0", collapsed ? "size-[19px]" : "size-[18px]")} strokeWidth={active ? 2.2 : 1.9} />
                  <span className={cn("truncate", collapsed && "max-w-full")}>{collapsed ? shortLabel(item.label) : item.label}</span>
                  {!collapsed && soon && <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase">P{item.phase}</span>}
                </Link>
              );
              return <li key={item.label}>{collapsed ? <Tooltip content={item.label} side="right">{content}</Tooltip> : content}</li>;
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Rail labels must fit ~60px: keep the first word, abbreviate the long ones. */
function shortLabel(label: string) {
  const map: Record<string, string> = { "Daily Report": "Report", "Time Reports": "Time", "Client Reports": "Clients", "Project Reports": "Projects", "Audit log": "Audit", Announcements: "News", Notifications: "Alerts", Subscription: "Plan", Attendance: "Attend", Timesheets: "Sheets", Employees: "People", "My Tasks": "Tasks" };
  return map[label] ?? label.split(" ")[0];
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const me = useAuth();
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col overflow-hidden rounded-2xl bg-sidebar text-sidebar-foreground shadow-float transition-[width] duration-200 md:sticky md:top-4 md:flex md:h-[calc(100dvh-2rem)]",
        collapsed ? "w-[84px]" : "w-64",
      )}
    >
      <div className={cn("flex items-center pt-5 pb-3", collapsed ? "justify-center px-0" : "px-4")}>
        <BrandMark collapsed={collapsed} wide={!collapsed} companyName={me.company?.name} companyLogoUrl={me.company?.logoUrl} className={cn("text-white", !collapsed && "w-full")} />
      </div>
      <SidebarNav collapsed={collapsed} />
      <button
        onClick={onToggle}
        className="mx-2 mb-2 flex h-10 items-center justify-center gap-2 rounded-xl text-xs text-sidebar-foreground/80 hover:bg-white/6 hover:text-white"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" /> Collapse</>}
      </button>
    </aside>
  );
}

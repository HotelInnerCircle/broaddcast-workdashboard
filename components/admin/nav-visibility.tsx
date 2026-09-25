"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ClientApiError } from "@/lib/api/client";
import { navigationFor } from "@/config/navigation";
import { cn } from "@/lib/utils/cn";
import { ROLE_LABEL, type CompanyRole } from "@/types";

const ROLES: CompanyRole[] = ["EMPLOYEE", "TEAM_LEAD", "MANAGER", "HR", "COMPANY_ADMIN"];
export type HiddenNav = Record<CompanyRole, string[]>;

/**
 * Menu visibility (A71): switch sidebar items on or off per role, so features can be released
 * gradually. Hiding an item only removes it from the menu - it does not revoke permission, and a
 * direct link still works. "Menu visibility" itself can never be hidden.
 */
export function NavVisibility({ initial }: { initial: HiddenNav }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<HiddenNav>(initial);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const toggle = (role: CompanyRole, href: string) => {
    setHidden((h) => ({ ...h, [role]: h[role].includes(href) ? h[role].filter((x) => x !== href) : [...h[role], href] }));
    setDirty(true);
  };
  const setAll = (role: CompanyRole, hideEverything: boolean) => {
    const items = navigationFor(role).flatMap((g) => g.items.map((i) => i.href)).filter((h) => h !== "/admin/navigation");
    setHidden((h) => ({ ...h, [role]: hideEverything ? items : [] }));
    setDirty(true);
  };
  const save = async (next: HiddenNav = hidden) => {
    setSaving(true);
    try {
      await api("/api/admin/company", { method: "PATCH", json: { hiddenNav: next } });
      setDirty(false);
      toast.success("Menu visibility saved");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Could not save");
    } finally { setSaving(false); }
  };
  const showEverything = () => {
    const cleared = { EMPLOYEE: [], TEAM_LEAD: [], MANAGER: [], HR: [], COMPANY_ADMIN: [] } as HiddenNav;
    setHidden(cleared);
    void save(cleared);
  };

  return (
    <Tabs defaultValue="EMPLOYEE">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TabsList>{ROLES.map((r) => <TabsTrigger key={r} value={r}>{ROLE_LABEL[r]}{hidden[r].length > 0 && <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 text-[10px] font-bold text-warning">{hidden[r].length}</span>}</TabsTrigger>)}</TabsList>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={showEverything} loading={saving}><RotateCcw />Show everything</Button>
          <Button onClick={() => void save()} loading={saving} disabled={!dirty}>Save changes</Button>
        </div>
      </div>

      {ROLES.map((role) => {
        const groups = navigationFor(role);
        const off = hidden[role];
        return (
          <TabsContent key={role} value={role} className="space-y-4">
            <Card>
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>{ROLE_LABEL[role]} menu</CardTitle>
                  <CardDescription>{off.length === 0 ? "Everything is visible." : `${off.length} item${off.length === 1 ? "" : "s"} hidden from the sidebar.`}</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setAll(role, true)}>Hide all</Button>
                  <Button size="sm" variant="outline" onClick={() => setAll(role, false)}>Show all</Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 pt-0">
                {groups.map((g) => (
                  <div key={g.label}>
                    <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-muted-foreground">{g.label}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {g.items.map((i) => {
                        const locked = i.href === "/admin/navigation";
                        const on = locked || !off.includes(i.href);
                        return (
                          <label key={i.href} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors", locked ? "cursor-not-allowed bg-muted/50 opacity-70" : "cursor-pointer", on ? "bg-card ring-1 ring-border/70" : "bg-muted/60")}>
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
                              checked={on}
                              disabled={locked || saving}
                              onChange={() => toggle(role, i.href)}
                              aria-label={`${on ? "Hide" : "Show"} ${i.label} for ${ROLE_LABEL[role]}`}
                            />
                            <i.icon className={cn("size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                            <span className={cn("min-w-0 flex-1 truncate font-medium", !on && "text-muted-foreground line-through")}>{i.label}</span>
                            {locked ? <span className="shrink-0 text-[10px] font-semibold uppercase text-muted-foreground">always on</span>
                              : on ? <Eye className="size-4 shrink-0 text-muted-foreground" /> : <EyeOff className="size-4 shrink-0 text-muted-foreground" />}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

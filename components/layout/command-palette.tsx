"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search, Users, Building2, FolderKanban, ListChecks, MessageSquare, CornerDownLeft } from "lucide-react";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { Badge } from "@/components/ui/badge";

interface Results { employees: { id: string; name: string; email: string; role: string; href: string }[]; clients: { id: string; name: string; industry: string | null; href: string }[]; projects: { id: string; name: string; status: string; client: string | null; href: string }[]; tasks: { id: string; title: string; status: string; project: string | null; href: string }[]; messages: { id: string; body: string; sender: string | null; conversation: string; href: string }[] }
type Flat = { key: string; href: string; group: string; title: string; subtitle?: string; badge?: string };

/** Ctrl+K command palette (spec 12.22): grouped results, keyboard navigation, scope-filtered by the API. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); } };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey); window.addEventListener("wp:open-search", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("wp:open-search", onOpen); };
  }, []);
  useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 30); } else { setQ(""); setResults(null); setActive(0); } }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    const t = setTimeout(async () => { setLoading(true); try { setResults(await api<Results>(`/api/search?q=${encodeURIComponent(q.trim())}`)); setActive(0); } catch { setResults(null); } finally { setLoading(false); } }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const flat: Flat[] = results ? [
    ...results.employees.map((e) => ({ key: `e${e.id}`, href: e.href, group: "Employees", title: e.name, subtitle: e.email })),
    ...results.clients.map((c) => ({ key: `c${c.id}`, href: c.href, group: "Clients", title: c.name, subtitle: c.industry ?? undefined })),
    ...results.projects.map((p) => ({ key: `p${p.id}`, href: p.href, group: "Projects", title: p.name, subtitle: p.client ?? undefined, badge: p.status })),
    ...results.tasks.map((t) => ({ key: `t${t.id}`, href: t.href, group: "Tasks", title: t.title, subtitle: t.project ?? undefined, badge: t.status })),
    ...results.messages.map((m) => ({ key: `m${m.id}`, href: m.href, group: "Messages", title: m.body, subtitle: `${m.sender ?? ""} in ${m.conversation}` })),
  ] : [];
  const go = useCallback((item: Flat) => { setOpen(false); router.push(item.href); }, [router]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && flat[active]) { e.preventDefault(); go(flat[active]); }
  };
  const ICONS: Record<string, typeof Users> = { Employees: Users, Clients: Building2, Projects: FolderKanban, Tasks: ListChecks, Messages: MessageSquare };
  let idx = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl bg-card ring-1 ring-border/60 shadow-xl focus:outline-none">
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search employees, clients, projects, tasks and messages</DialogPrimitive.Description>
          <div className="flex items-center gap-2 border-b border-border px-4">
            <Search className="size-4 text-muted-foreground" />
            <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder="Search employees, clients, projects, tasks, messages..." className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
            <kbd className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">Esc</kbd>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {q.trim().length < 2 ? <p className="p-6 text-center text-sm text-muted-foreground">Type at least two characters. Try a client name like &ldquo;Amaya&rdquo;.</p>
              : loading && !results ? <p className="p-6 text-center text-sm text-muted-foreground">Searching...</p>
              : flat.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No results for &ldquo;{q}&rdquo;.</p>
              : ["Employees", "Clients", "Projects", "Tasks", "Messages"].map((group) => {
                const items = flat.filter((f) => f.group === group);
                if (items.length === 0) return null;
                const Icon = ICONS[group];
                return (
                  <div key={group} className="mb-2">
                    <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group} <span className="font-normal">({items.length})</span></p>
                    {items.map((item) => { idx++; const i = idx; return (
                      <button key={item.key} onMouseEnter={() => setActive(i)} onClick={() => go(item)} className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm", active === i ? "bg-primary-soft text-primary" : "hover:bg-muted")}>
                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1"><span className="block truncate">{item.title}</span>{item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}</span>
                        {item.badge && <Badge variant="outline">{item.badge}</Badge>}
                        {active === i && <CornerDownLeft className="size-3.5 text-muted-foreground" />}
                      </button>
                    ); })}
                  </div>
                );
              })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

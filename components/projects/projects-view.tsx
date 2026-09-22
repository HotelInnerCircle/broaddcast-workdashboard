"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FolderKanban, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { apiPaged, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { usePickers } from "@/hooks/usePickers";
import { PROJECT_STATUSES } from "@/types";
import { ProjectCard } from "./project-card";
import { ProjectDialog } from "./project-dialog";
import type { ProjectRow } from "@/components/tasks/types";

export function ProjectsView() {
  const me = useAuth();
  const params = useSearchParams();
  const canCreate = me.can("projects", "create");
  const { clients } = usePickers({ clients: true });
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [clientId, setClientId] = useState(params.get("clientId") ?? "");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(params.get("new") === "1" && canCreate);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: "24", ...(q ? { q } : {}), ...(status ? { status } : {}), ...(clientId ? { clientId } : {}), ...(archived ? { includeArchived: "true" } : {}) });
      const r = await apiPaged<ProjectRow>(`/api/projects?${qs}`);
      setRows(r.data); setMeta(r.meta);
    } catch (e) { setError(e instanceof ClientApiError ? e.message : "Failed to load projects"); }
  }, [page, q, status, clientId, archived]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageHeader title="Projects" description="Progress is completed tasks divided by non-cancelled tasks." actions={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus />New project</Button>} />
      <Card className="mb-6 flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search projects" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <NativeSelect className="w-44" value={clientId} onChange={(e) => { setClientId(e.target.value); setPage(1); }}><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        <NativeSelect className="w-40" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</NativeSelect>
        <label className="inline-flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" className="accent-primary" checked={archived} onChange={(e) => { setArchived(e.target.checked); setPage(1); }} />Show archived</label>
      </Card>
      {error ? <ErrorState message={error} onRetry={load} /> : rows === null ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={FolderKanban} title="No projects yet" description={canCreate ? "Create a project under a client and start adding tasks." : "You are not a member of any project yet."} action={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus />Create project</Button>} /></Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{rows.map((p) => <ProjectCard key={p.id} project={p} />)}</div>
          {meta.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground"><span>{meta.total} projects</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button></div></div>
          )}
        </>
      )}
      <ProjectDialog project={null} open={dialogOpen} defaultClientId={clientId || null} onClose={() => setDialogOpen(false)} onSaved={() => void load()} />
    </>
  );
}

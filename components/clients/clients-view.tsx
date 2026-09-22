"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Plus, Search, Archive, ArchiveRestore, Pencil, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { ClientStatusBadge } from "@/components/ui/status-badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, apiPaged, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { ClientDialog } from "./client-dialog";
import type { ClientRow } from "@/components/tasks/types";

export function ClientsView() {
  const me = useAuth();
  const canCreate = me.can("clients", "create");
  const canEdit = me.can("clients", "update");
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ open: boolean; client: ClientRow | null }>({ open: false, client: null });

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: "20", ...(q ? { q } : {}), ...(status ? { status } : {}), ...(archived ? { includeArchived: "true" } : {}) });
      const r = await apiPaged<ClientRow>(`/api/clients?${qs}`);
      setRows(r.data); setMeta(r.meta);
    } catch (e) { setError(e instanceof ClientApiError ? e.message : "Failed to load clients"); }
  }, [page, q, status, archived]);
  useEffect(() => { void load(); }, [load]);

  const toggleArchive = async (c: ClientRow) => {
    const archiving = !c.archivedAt;
    if (archiving && !confirm(`Archive ${c.name}? It disappears from pickers and lists but all history is kept.`)) return;
    try {
      await api(`/api/clients/${c.id}`, { method: "PATCH", json: { archived: archiving } });
      toast.success(archiving ? "Client archived" : "Client restored");
      void load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Action failed"); }
  };

  return (
    <>
      <PageHeader title="Clients" description="Companies you do work for. Managers add clients; everyone under that manager sees them automatically." actions={canCreate && <Button onClick={() => setDialog({ open: true, client: null })}><Plus />Add client</Button>} />
      <Card>
        <CardHeader className="flex-row flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Search clients" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <NativeSelect className="w-36" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></NativeSelect>
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={archived} onChange={(e) => { setArchived(e.target.checked); setPage(1); }} className="accent-primary" />Show archived</label>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          {error ? <ErrorState message={error} onRetry={load} /> : rows === null ? <TableSkeleton rows={5} cols={6} /> : rows.length === 0 ? (
            <EmptyState icon={Building2} title="No clients yet" description={canCreate ? "Add your first client to start creating projects." : "Your manager has not added any clients yet."} action={canCreate && <Button onClick={() => setDialog({ open: true, client: null })}><Plus />Create client</Button>} />
          ) : (
            <Table>
              <THead><TR><TH>Client</TH><TH>Contact</TH><TH>Industry</TH><TH>Projects</TH><TH>Open tasks</TH><TH>Status</TH>{canEdit && <TH className="w-12" />}</TR></THead>
              <TBody>
                {rows.map((c) => (
                  <TR key={c.id} className={c.archivedAt ? "opacity-60" : ""}>
                    <TD><Link href={`/clients/${c.id}`} className="font-medium hover:text-primary hover:underline">{c.name}</Link>{c.website && <p className="truncate text-xs text-muted-foreground">{c.website}</p>}</TD>
                    <TD>{c.contactPerson ?? "-"}{c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}</TD>
                    <TD className="text-muted-foreground">{c.industry ?? "-"}</TD>
                    <TD>{c.projects ?? 0}<span className="text-xs text-muted-foreground"> ({c.activeProjects ?? 0} active)</span></TD>
                    <TD>{c.openTasks ?? 0}</TD>
                    <TD><ClientStatusBadge status={c.status} archived={!!c.archivedAt} /></TD>
                    {canEdit && (
                      <TD>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Client actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setDialog({ open: true, client: c })}><Pencil />Edit</DropdownMenuItem>
                            <DropdownMenuItem destructive={!c.archivedAt} onSelect={() => toggleArchive(c)}>{c.archivedAt ? <><ArchiveRestore />Restore</> : <><Archive />Archive</>}</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-muted-foreground">
              <span>{meta.total} clients</span>
              <div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button></div>
            </div>
          )}
        </CardContent>
      </Card>
      <ClientDialog client={dialog.client} open={dialog.open} onClose={() => setDialog({ open: false, client: null })} onSaved={() => void load()} />
    </>
  );
}

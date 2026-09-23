"use client";
import { useCallback, useEffect, useState } from "react";
import { ScrollText, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { apiPaged, ClientApiError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

export interface AuditRow { id: string; company?: string | null; entity: string; entityId: string | null; action: string; summary: string | null; actorName: string | null; actorRole: string | null; crossTenant: boolean; before?: unknown; after?: unknown; ip?: string | null; createdAt: string }

/**
 * Audit log viewer (spec 7.9 / Phase 6). `platform` mode targets the Super Admin endpoint and
 * shows the company column plus a cross-tenant filter.
 */
export function AuditViewer({ platform = false, companies = [] }: { platform?: boolean; companies?: { id: string; name: string }[] }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0, entities: [] as string[] });
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [crossOnly, setCrossOnly] = useState(false);
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: "25", ...(action ? { action } : {}), ...(entity ? { entity } : {}), ...(companyId ? { companyId } : {}), ...(crossOnly ? { crossTenant: "true" } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
      const r = await apiPaged<AuditRow>(`${platform ? "/api/super-admin/audit" : "/api/admin/audit"}?${qs}`);
      setRows(r.data); setMeta({ ...r.meta, entities: (r.meta as { entities?: string[] }).entities ?? [] });
    } catch (e) { setError(e instanceof ClientApiError ? e.message : "Failed to load audit log"); }
  }, [page, action, entity, companyId, crossOnly, from, to, platform]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageHeader title={platform ? "Platform audit log" : "Audit log"} description={platform ? "Every company's audit trail plus all cross-tenant Super Admin actions. Viewing this log is itself audited." : "Append-only record of every important action in your company."} />
      <Card>
        <CardHeader className="flex-row flex-wrap items-end gap-3">
          <Field label="Action contains" htmlFor="au-action"><Input id="au-action" className="w-44" placeholder="e.g. task.status" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} /></Field>
          {!platform && <Field label="Entity" htmlFor="au-entity"><NativeSelect id="au-entity" className="w-40" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}><option value="">All entities</option>{meta.entities.map((x) => <option key={x} value={x}>{x}</option>)}</NativeSelect></Field>}
          {platform && <Field label="Company" htmlFor="au-company"><NativeSelect id="au-company" className="w-44" value={companyId} onChange={(e) => { setCompanyId(e.target.value); setPage(1); }}><option value="">All companies</option>{companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>}
          {!platform && <><Field label="From" htmlFor="au-from"><Input id="au-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></Field><Field label="To" htmlFor="au-to"><Input id="au-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></Field></>}
          {platform && <label className="inline-flex items-center gap-2 pb-2.5 text-sm text-muted-foreground"><input type="checkbox" className="accent-primary" checked={crossOnly} onChange={(e) => { setCrossOnly(e.target.checked); setPage(1); }} />Cross-tenant only</label>}
        </CardHeader>
        <CardContent className="p-0 pt-0">
          {error ? <ErrorState message={error} onRetry={load} /> : rows === null ? <TableSkeleton rows={8} cols={5} /> : rows.length === 0 ? <EmptyState icon={ScrollText} title="No audit entries" description="Nothing matches these filters." /> : (
            <Table>
              <THead><TR><TH className="w-8 max-lg:hidden" /><TH>When</TH>{platform && <TH>Company</TH>}<TH>Actor</TH><TH>Action</TH><TH>Summary</TH></TR></THead>
              <TBody>{rows.map((r) => (
                <>
                  <TR key={r.id} className={cn("cursor-pointer", r.crossTenant && "bg-warning-soft/30")} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <TD hideOnMobile className="max-lg:hidden">{open === r.id ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}</TD>
                    <TD label="When" className="text-muted-foreground max-xl:whitespace-normal xl:whitespace-nowrap">{formatDateTime(r.createdAt)}</TD>
                    {platform && <TD label="Company">{r.company ?? <span className="text-muted-foreground">platform</span>}</TD>}
                    <TD label="Actor">{r.actorName ?? <span className="text-muted-foreground">System</span>}{r.actorRole && <span className="ml-1 text-xs text-muted-foreground">({r.actorRole.replace("_", " ").toLowerCase()})</span>}</TD>
                    <TD label="Action" className="max-md:flex-wrap max-xl:whitespace-normal"><span className="font-mono text-xs break-words max-xl:break-all">{r.action}</span>{r.crossTenant && <Badge variant="warning" className="ml-2">cross-tenant</Badge>}</TD>
                    <TD primary className="max-w-md truncate max-xl:max-w-48 max-md:max-w-none max-md:whitespace-normal">{r.summary ?? "-"}</TD>
                  </TR>
                  {open === r.id && (
                    <TR key={`${r.id}-d`}><TD colSpan={platform ? 6 : 5} className="bg-muted/40">
                      <div className="grid min-w-0 gap-3 text-xs sm:grid-cols-2">
                        <div className="min-w-0"><p className="mb-1 font-medium">Before</p><pre className="max-h-48 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded bg-card p-2">{r.before ? JSON.stringify(r.before, null, 2) : "-"}</pre></div>
                        <div className="min-w-0"><p className="mb-1 font-medium">After</p><pre className="max-h-48 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded bg-card p-2">{r.after ? JSON.stringify(r.after, null, 2) : "-"}</pre></div>
                        <p className="text-muted-foreground sm:col-span-2">entity {r.entity}{r.entityId ? ` #${r.entityId}` : ""}{r.ip ? ` - ip ${r.ip}` : ""}</p>
                      </div>
                    </TD></TR>
                  )}
                </>
              ))}</TBody>
            </Table>
          )}
          {meta.totalPages > 1 && <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-muted-foreground"><span>{meta.total} entries</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button></div></div>}
        </CardContent>
      </Card>
    </>
  );
}

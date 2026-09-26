"use client";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Users, UserPlus, Search, RefreshCw, XCircle, Mail, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { api, apiPaged, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/utils/dates";
import { RelativeTime } from "@/components/ui/relative-time";
import { ROLE_LABEL } from "@/types";
import { InviteDialog } from "./invite-dialog";
import { EmployeeSheet } from "./employee-sheet";
import type { EmployeeRow, InviteRow, TeamOption } from "./types";

export function EmployeesView() {
  const me = useAuth();
  const params = useSearchParams();
  const canInvite = me.can("employees", "invite");
  const canEdit = me.can("employees", "update");
  const [rows, setRows] = useState<EmployeeRow[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0 });
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(params.get("invite") === "1");
  const [selected, setSelected] = useState<EmployeeRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: "20", ...(q ? { q } : {}), ...(status ? { status } : {}) });
      const [emp, inv, tm] = await Promise.all([
        apiPaged<EmployeeRow>(`/api/employees?${qs}`),
        canInvite ? api<InviteRow[]>("/api/invites") : Promise.resolve([]),
        api<TeamOption[]>("/api/teams").catch(() => []),
      ]);
      setRows(emp.data); setMeta(emp.meta); setInvites(inv); setTeams(tm);
    } catch (e) { setError(e instanceof ClientApiError ? e.message : "Failed to load employees"); }
  }, [page, q, status, canInvite]);

  useEffect(() => { void load(); }, [load]);

  const inviteAction = async (id: string, action: "resend" | "revoke") => {
    try {
      if (action === "resend") await api(`/api/invites/${id}/resend`, { method: "POST" });
      else await api(`/api/invites/${id}`, { method: "DELETE" });
      toast.success(action === "resend" ? "Invitation resent" : "Invitation revoked");
      void load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Action failed"); }
  };

  const managers = (rows ?? []).filter((r) => ["MANAGER", "COMPANY_ADMIN"].includes(r.role) && r.status === "active");

  return (
    <>
      <PageHeader
        title="Employees"
        description={me.role === "COMPANY_ADMIN" ? "Everyone in your company." : "People within your scope."}
        actions={canInvite && <Button onClick={() => setInviteOpen(true)}><UserPlus />Add employee</Button>}
      />
      <Card>
        <CardHeader className="flex-row flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by name or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
          <NativeSelect className="w-44" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Active + invited</option>
            <option value="active">Active</option>
            <option value="invited">Invited</option>
            <option value="deactivated">Deactivated</option>
          </NativeSelect>
        </CardHeader>
        <CardContent className="p-0 pt-0">
          {error ? (
            <ErrorState message={error} onRetry={load} />
          ) : rows === null ? (
            <TableSkeleton rows={6} cols={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No employees found"
              description={canInvite ? "Add your first teammate to get started." : "Nobody matches these filters."}
              action={canInvite && <Button onClick={() => setInviteOpen(true)}><UserPlus />Add employee</Button>}
            />
          ) : (
            <Table>
              <THead><TR><TH>Employee</TH><TH>Role</TH><TH>Team</TH><TH>Manager</TH><TH>Status</TH><TH>Last active</TH>{canEdit && <TH className="w-12" />}</TR></THead>
              <TBody>
                {rows.map((r) => (
                  <TR key={r.id}>
                    <TD primary>
                      <div className="flex items-center gap-3">
                        <Avatar name={r.name} src={r.avatarUrl} size="sm" />
                        <div className="min-w-0"><Link href={`/employees/${r.id}`} className="block truncate font-medium hover:text-primary hover:underline">{r.name}</Link><p className="truncate text-xs text-muted-foreground">{r.email}</p></div>
                      </div>
                    </TD>
                    <TD label="Role"><Badge variant="outline">{r.roleLabel}</Badge>{r.designation && <p className="mt-1 text-xs text-muted-foreground">{r.designation}</p>}</TD>
                    <TD label="Team" className="text-muted-foreground">{r.team?.name ?? "-"}</TD>
                    <TD label="Manager" className="text-muted-foreground">{r.manager?.name ?? "-"}</TD>
                    <TD label="Status"><Badge variant={r.status === "active" ? "success" : r.status === "invited" ? "warning" : "danger"}>{r.status}</Badge></TD>
                    <TD label="Last active" className="text-xs text-muted-foreground"><RelativeTime value={r.lastActiveAt} /></TD>
                    {canEdit && <TD><Button variant="ghost" size="icon" aria-label={`Edit ${r.name}`} onClick={() => setSelected(r)}><Pencil /></Button></TD>}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-muted-foreground">
              <span>{meta.total} people</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {canInvite && invites.length > 0 && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Pending invitations</CardTitle><CardDescription>Links expire 7 days after they are sent.</CardDescription></CardHeader>
          <CardContent className="p-0 pt-0">
            <Table>
              <THead><TR><TH>Email</TH><TH>Role</TH><TH>Team</TH><TH>Expires</TH><TH className="text-right">Actions</TH></TR></THead>
              <TBody>
                {invites.map((i) => (
                  <TR key={i.id}>
                    <TD primary className="font-medium"><span className="inline-flex items-center gap-2"><Mail className="size-4 text-muted-foreground" />{i.email}</span></TD>
                    <TD label="Role"><Badge variant="outline">{ROLE_LABEL[i.role as keyof typeof ROLE_LABEL]}</Badge></TD>
                    <TD label="Team" className="text-muted-foreground">{i.team ?? "-"}</TD>
                    <TD label="Expires" className="text-muted-foreground">{formatDate(i.expiresAt)}</TD>
                    <TD className="text-right max-md:text-left">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => inviteAction(i.id, "resend")}><RefreshCw />Resend</Button>
                        <Button variant="ghost" size="sm" className="text-danger" onClick={() => inviteAction(i.id, "revoke")}><XCircle />Revoke</Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} teams={teams} managers={managers} onInvited={load} />
      <EmployeeSheet employee={selected} teams={teams} managers={managers} onClose={() => setSelected(null)} onSaved={load} />
    </>
  );
}

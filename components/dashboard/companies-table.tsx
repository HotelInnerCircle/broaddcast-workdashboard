"use client";
import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal, Ban, CheckCircle2, CreditCard, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { api, ClientApiError } from "@/lib/api/client";
import { formatDate } from "@/lib/utils/dates";
import { DeleteCompanyDialog } from "@/components/super-admin/company-dialogs";

export interface CompanyRow { id: string; name: string; slug: string; status: string; createdAt: Date | string; users: number; plan: string | null; planId: string | null }
interface PlanOption { id: string; name: string; price: number }

export function CompaniesTable({ initial, plans }: { initial: CompanyRow[]; plans: PlanOption[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CompanyRow | null>(null);

  const patch = async (id: string, body: Record<string, unknown>, okMsg: string) => {
    setBusy(id);
    try {
      const res = await api<{ status: string; planId: string | null }>(`/api/super-admin/companies/${id}`, { method: "PATCH", json: body });
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status: res.status, planId: res.planId, plan: plans.find((p) => p.id === res.planId)?.name ?? r.plan } : r)));
      toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>Companies</CardTitle><CardDescription>Suspend, reactivate, change a plan or delete. Suspension signs out every user immediately; deletion removes all of the company&apos;s data.</CardDescription></CardHeader>
      <CardContent className="p-0 pt-0">
        <Table>
          <THead><TR><TH>Company</TH><TH>Users</TH><TH>Plan</TH><TH>Created</TH><TH>Status</TH><TH className="w-12" /></TR></THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id}>
                <TD><Link href={`/super-admin/companies/${c.id}`} className="font-medium hover:text-primary hover:underline">{c.name}</Link><p className="text-xs text-muted-foreground">{c.slug}</p></TD>
                <TD>{c.users}</TD>
                <TD>{c.plan ?? <span className="text-muted-foreground">None</span>}</TD>
                <TD className="text-muted-foreground">{formatDate(c.createdAt)}</TD>
                <TD><Badge variant={c.status === "active" ? "success" : "danger"}>{c.status}</Badge></TD>
                <TD>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" loading={busy === c.id} aria-label="Company actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {c.status === "active" ? (
                        <DropdownMenuItem destructive onSelect={() => patch(c.id, { status: "suspended", reason: "Suspended by super admin" }, `${c.name} suspended`)}><Ban />Suspend company</DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => patch(c.id, { status: "active" }, `${c.name} reactivated`)}><CheckCircle2 />Reactivate company</DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Change plan</DropdownMenuLabel>
                      {plans.map((p) => (
                        <DropdownMenuItem key={p.id} disabled={p.id === c.planId} onSelect={() => patch(c.id, { planId: p.id }, `${c.name} moved to ${p.name}`)}><CreditCard />{p.name}</DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive onSelect={() => setDeleting(c)}><Trash2 />Delete company</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
      <DeleteCompanyDialog company={deleting} open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} onDeleted={(id) => setRows((rs) => rs.filter((r) => r.id !== id))} />
    </Card>
  );
}

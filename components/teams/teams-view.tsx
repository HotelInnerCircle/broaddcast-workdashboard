"use client";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { UsersRound, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/page-header";
import { api, apiPaged, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { createTeamSchema, type CreateTeamInput } from "@/lib/validation/teams";
import type { EmployeeRow, TeamOption } from "@/components/employees/types";

export function TeamsView() {
  const me = useAuth();
  const canCreate = me.can("teams", "create");
  const canEdit = me.can("teams", "update");
  const [teams, setTeams] = useState<TeamOption[] | null>(null);
  const [people, setPeople] = useState<EmployeeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TeamOption | null | "new">(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, p] = await Promise.all([api<TeamOption[]>("/api/teams"), canEdit ? apiPaged<EmployeeRow>("/api/employees?limit=100&status=active") : Promise.resolve({ data: [] })]);
      setTeams(t); setPeople(p.data);
    } catch (e) { setError(e instanceof ClientApiError ? e.message : "Failed to load teams"); }
  }, [canEdit]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageHeader title="Teams" description="Each employee belongs to exactly one team; each team has one lead." actions={canCreate && <Button onClick={() => setEditing("new")}><Plus />New team</Button>} />
      {error ? <ErrorState message={error} onRetry={load} /> : teams === null ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : teams.length === 0 ? (
        <Card><EmptyState icon={UsersRound} title="No teams yet" description="Create a team, then invite people into it." action={canCreate && <Button onClick={() => setEditing("new")}><Plus />Create team</Button>} /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <CardHeader className="flex-row items-start justify-between">
                <div><CardTitle>{t.name}</CardTitle><CardDescription>{t.memberCount} member{t.memberCount === 1 ? "" : "s"}</CardDescription></div>
                {canEdit && <Button variant="ghost" size="icon" aria-label="Edit team" onClick={() => setEditing(t)}><Pencil /></Button>}
              </CardHeader>
              <CardContent className="mt-auto space-y-3 pt-0 text-sm">
                {t.description && <p className="text-muted-foreground">{t.description}</p>}
                <Person label="Lead" person={t.lead} />
                <Person label="Manager" person={t.manager} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <TeamDialog team={editing} people={people} onClose={() => setEditing(null)} onSaved={load} />
    </>
  );
}

function Person({ label, person }: { label: string; person: { name: string } | null }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-xs text-muted-foreground">{label}</span>
      {person ? <><Avatar name={person.name} size="sm" /><span>{person.name}</span></> : <span className="text-muted-foreground">Not set</span>}
    </div>
  );
}

function TeamDialog({ team, people, onClose, onSaved }: { team: TeamOption | null | "new"; people: EmployeeRow[]; onClose: () => void; onSaved: () => void }) {
  const me = useAuth();
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CreateTeamInput>({ resolver: zodResolver(createTeamSchema) });
  useEffect(() => {
    if (team === "new") reset({ name: "", description: "", leadId: null, managerId: null });
    else if (team) reset({ name: team.name, description: team.description ?? "", leadId: team.lead?.id ?? null, managerId: team.manager?.id ?? null });
  }, [team, reset]);

  const onSubmit = async (values: CreateTeamInput) => {
    const body = { ...values, description: values.description || null, leadId: values.leadId || null, managerId: values.managerId || null };
    try {
      if (team === "new") await api("/api/teams", { method: "POST", json: body });
      else if (team) await api(`/api/teams/${team.id}`, { method: "PATCH", json: body });
      toast.success(team === "new" ? "Team created" : "Team updated");
      onSaved(); onClose();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save team"); }
  };

  const leads = people.filter((p) => ["TEAM_LEAD", "MANAGER", "COMPANY_ADMIN"].includes(p.role));
  const managers = people.filter((p) => ["MANAGER", "COMPANY_ADMIN"].includes(p.role));
  return (
    <Dialog open={team !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={team === "new" ? "New team" : "Edit team"}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Name" htmlFor="team-name" error={errors.name?.message}><Input id="team-name" {...register("name")} /></Field>
          <Field label="Description" htmlFor="team-desc"><Textarea id="team-desc" rows={2} {...register("description")} /></Field>
          {me.role !== "TEAM_LEAD" && (
            <Field label="Team lead" htmlFor="team-lead"><NativeSelect id="team-lead" {...register("leadId")}><option value="">Not set</option>{leads.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.roleLabel})</option>)}</NativeSelect></Field>
          )}
          {me.role === "COMPANY_ADMIN" && (
            <Field label="Managed by" htmlFor="team-manager"><NativeSelect id="team-manager" {...register("managerId")}><option value="">Not set</option>{managers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.roleLabel})</option>)}</NativeSelect></Field>
          )}
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>{team === "new" ? "Create team" : "Save"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

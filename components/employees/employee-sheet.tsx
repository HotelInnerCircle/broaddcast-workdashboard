"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { api, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { useDesignations } from "@/hooks/usePickers";
import { formatDate } from "@/lib/utils/dates";
import { RelativeTime } from "@/components/ui/relative-time";
import { COMPANY_ROLES, ROLE_LABEL, type CompanyRole } from "@/types";
import type { EmployeeRow, TeamOption } from "./types";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  role: z.enum(COMPANY_ROLES),
  teamId: z.string().nullable(),
  shiftId: z.string().nullable(),
  managerId: z.string().nullable(),
  department: z.string().max(80).nullable(),
  branch: z.string().max(80).nullable(),
  employeeCode: z.string().max(24).nullable(),
  designation: z.string().max(60).nullable(),
  phone: z.string().max(30).nullable(),
});
type Input = z.infer<typeof schema>;

export function EmployeeSheet({ employee, teams, managers, onClose, onSaved }: { employee: EmployeeRow | null; teams: TeamOption[]; managers: EmployeeRow[]; onClose: () => void; onSaved: () => void }) {
  const me = useAuth();
  const isAdmin = me.role === "COMPANY_ADMIN";
  const roles: CompanyRole[] = isAdmin ? ["EMPLOYEE", "TEAM_LEAD", "MANAGER", "HR", "COMPANY_ADMIN"] : ["EMPLOYEE", "TEAM_LEAD"];
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<Input>({ resolver: zodResolver(schema) });
  // A90: the working pattern this person is judged against. Empty means the company hours.
  const [shifts, setShifts] = useState<Array<{ id: string; name: string; startTime: string; endTime: string }>>([]);
  useEffect(() => { void api<typeof shifts>("/api/shifts").then(setShifts).catch(() => setShifts([])); }, []);
  const designations = useDesignations(Boolean(employee));

  useEffect(() => {
    if (employee) reset({ name: employee.name, role: employee.role as CompanyRole, teamId: employee.team?.id ?? null, shiftId: employee.shiftId ?? null, managerId: employee.manager?.id ?? null, department: employee.department, branch: employee.branch ?? null, employeeCode: employee.employeeCode ?? null, designation: employee.designation, phone: employee.phone });
  }, [employee, reset]);

  const save = async (values: Input) => {
    if (!employee) return;
    const body: Record<string, unknown> = { name: values.name, teamId: values.teamId || null, shiftId: values.shiftId || null, department: values.department || null, branch: values.branch || null, employeeCode: values.employeeCode || null, designation: values.designation || null, phone: values.phone || null };
    if (values.role !== employee.role) body.role = values.role;
    if (isAdmin) body.managerId = values.managerId || null;
    try {
      await api(`/api/employees/${employee.id}`, { method: "PATCH", json: body });
      toast.success(values.role !== employee.role ? "Saved. Role changed - their sessions were signed out." : "Employee updated");
      onSaved(); onClose();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save changes"); }
  };

  const setStatus = async (status: "active" | "deactivated") => {
    if (!employee) return;
    if (status === "deactivated" && !confirm(`Deactivate ${employee.name}? They will be signed out immediately and cannot log in. Their history is kept.`)) return;
    try {
      await api(`/api/employees/${employee.id}`, { method: "PATCH", json: { status } });
      toast.success(status === "deactivated" ? `${employee.name} deactivated` : `${employee.name} reactivated`);
      onSaved(); onClose();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Action failed"); }
  };

  const self = employee?.id === me.userId;
  return (
    <Dialog open={!!employee} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" title="Employee" description="Profile, role and team.">
        {employee && (
          <form onSubmit={handleSubmit(save)} className="space-y-5" noValidate>
            <div className="flex items-center gap-3">
              <Avatar name={employee.name} src={employee.avatarUrl} size="lg" />
              <div className="min-w-0">
                <p className="truncate font-medium">{employee.name}</p>
                <p className="truncate text-sm text-muted-foreground">{employee.email}</p>
                <div className="mt-1 flex gap-1.5"><Badge variant={employee.status === "active" ? "success" : employee.status === "invited" ? "warning" : "danger"}>{employee.status}</Badge><Badge variant="outline">{employee.roleLabel}</Badge></div>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/60 p-3 text-xs">
              <div><dt className="text-muted-foreground">Joined</dt><dd className="font-medium">{formatDate(employee.joiningDate)}</dd></div>
              <div><dt className="text-muted-foreground">Last active</dt><dd className="font-medium"><RelativeTime value={employee.lastActiveAt} /></dd></div>
            </dl>
            <Field label="Name" htmlFor="emp-name" error={errors.name?.message}><Input id="emp-name" {...register("name")} /></Field>
            <Field label="Role" htmlFor="emp-role" hint={self ? "You cannot change your own role." : "Changing the role signs the person out everywhere."}>
              <NativeSelect id="emp-role" disabled={self} {...register("role")}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</NativeSelect>
            </Field>
            <Field label="Shift" htmlFor="emp-shift" hint={shifts.length === 0 ? "No shifts defined - everyone is on the company hours." : "Lateness and half days are judged against this."}>
              <NativeSelect id="emp-shift" {...register("shiftId")}>
                <option value="">Company hours</option>
                {shifts.map((sh) => <option key={sh.id} value={sh.id}>{sh.name} ({sh.startTime}-{sh.endTime})</option>)}
              </NativeSelect>
            </Field>
            <Field label="Employee code" htmlFor="emp-code" hint="Leave blank to keep the one assigned."><Input id="emp-code" {...register("employeeCode")} /></Field>
            <Field label="Branch" htmlFor="emp-branch" hint="Which office or site."><Input id="emp-branch" {...register("branch")} /></Field>
            <Field label="Team" htmlFor="emp-team"><NativeSelect id="emp-team" {...register("teamId")}><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Field>
            {isAdmin && (
              <Field label="Reports to" htmlFor="emp-manager"><NativeSelect id="emp-manager" {...register("managerId")}><option value="">No manager</option>{managers.filter((m) => m.id !== employee.id).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.roleLabel})</option>)}</NativeSelect></Field>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Designation" htmlFor="emp-designation" hint={designations.length === 0 ? "Add designations in Settings > Company." : undefined}>
                <NativeSelect id="emp-designation" {...register("designation")}>
                  <option value="">No designation</option>
                  {[...designations, ...(employee?.designation && !designations.includes(employee.designation) ? [employee.designation] : [])].map((d) => <option key={d} value={d}>{d}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Department" htmlFor="emp-dept"><Input id="emp-dept" {...register("department")} /></Field>
              <Field label="Phone" htmlFor="emp-phone"><Input id="emp-phone" {...register("phone")} /></Field>
            </div>
            <DialogFooter className="items-center sm:justify-between">
              {isAdmin && !self ? (
                employee.status === "deactivated"
                  ? <Button type="button" variant="outline" onClick={() => setStatus("active")}>Reactivate</Button>
                  : <Button type="button" variant="ghost" className="text-danger hover:bg-danger-soft" onClick={() => setStatus("deactivated")}>Deactivate</Button>
              ) : <span />}
              <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>Save changes</Button></div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

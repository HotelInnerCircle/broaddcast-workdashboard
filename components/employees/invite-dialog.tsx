"use client";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, KeyRound, Mail, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/api/client";
import { showLimitError } from "@/lib/api/limit-toast";
import { createEmployeeSchema, createInviteSchema, type CreateInviteInput } from "@/lib/validation/employees";
import { useAuth } from "@/hooks/useAuth";
import { useDesignations } from "@/hooks/usePickers";
import { cn } from "@/lib/utils/cn";
import { ROLE_LABEL, type CompanyRole } from "@/types";
import type { EmployeeRow, TeamOption } from "./types";

type Mode = "create" | "invite";
/** One form for both modes: name/password are only validated (and sent) in "create" mode. */
type FormValues = CreateInviteInput & { name?: string; password?: string; designation?: string | null };
interface Credentials { name: string; email: string; password: string; role: string }

/** A readable 12-character password that satisfies the password rule (letter + number). */
function generatePassword() {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", digits = "23456789", all = letters + digits;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  const chars = [pick(letters.toUpperCase()), pick(letters), pick(digits), ...Array.from({ length: 9 }, () => pick(all))];
  return chars.sort(() => Math.random() - 0.5).join("");
}

/**
 * Add a teammate (A56): create the account with a password now and hand the credentials over, or
 * send an email invitation so they set their own password.
 */
export function InviteDialog({ open, onOpenChange, teams, managers, onInvited }: { open: boolean; onOpenChange: (o: boolean) => void; teams: TeamOption[]; managers: EmployeeRow[]; onInvited: () => void }) {
  const me = useAuth();
  const roles: CompanyRole[] = me.role === "COMPANY_ADMIN" ? ["EMPLOYEE", "TEAM_LEAD", "MANAGER", "COMPANY_ADMIN"] : ["EMPLOYEE", "TEAM_LEAD"];
  const [mode, setMode] = useState<Mode>("create");
  const [done, setDone] = useState<Credentials | null>(null);
  const [copied, setCopied] = useState(false);
  const designations = useDesignations(open);
  const resolver = (mode === "create" ? zodResolver(createEmployeeSchema) : zodResolver(createInviteSchema)) as Resolver<FormValues>;
  const { register, handleSubmit, reset, setError, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver, defaultValues: { role: "EMPLOYEE", teamId: null, managerId: null, name: "", password: "", designation: null },
  });
  const password = watch("password");

  const close = () => { onOpenChange(false); setDone(null); setCopied(false); reset(); };

  const onSubmit = async (values: FormValues) => {
    const body = { ...values, teamId: values.teamId || null, managerId: values.managerId || null, designation: values.designation || null };
    try {
      if (mode === "create") {
        const res = await api<{ name: string; email: string; role: CompanyRole }>("/api/employees", { method: "POST", json: body });
        setDone({ name: res.name, email: res.email, password: values.password ?? "", role: ROLE_LABEL[res.role] });
        toast.success(`Account created for ${res.name}`);
      } else {
        await api("/api/invites", { method: "POST", json: { email: body.email, role: body.role, teamId: body.teamId, managerId: body.managerId, designation: body.designation } });
        toast.success(`Invitation sent to ${values.email}`);
        close();
      }
      onInvited();
    } catch (e) {
      if (e instanceof ClientApiError && e.code === "EMAIL_TAKEN") setError("email", { message: e.message });
      else if (showLimitError(e)) { /* upgrade prompt shown */ }
      else toast.error(e instanceof ClientApiError ? e.message : mode === "create" ? "Could not create the account" : "Could not send the invitation");
    }
  };

  const credentialsText = done ? `WorkPulse login for ${done.name} (${done.role})\nURL: ${window.location.origin}/login\nEmail: ${done.email}\nPassword: ${done.password}` : "";
  const copy = async () => { try { await navigator.clipboard.writeText(credentialsText); setCopied(true); } catch { toast.error("Copy failed - select the text manually"); } };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title={done ? "Account ready" : "Add a teammate"} description={done ? "Share these credentials with them privately. The password is shown only once." : undefined}>
        {done ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-muted px-4 py-3 text-sm">
              <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{done.name} <span className="text-xs text-muted-foreground">({done.role})</span></dd>
              <dt className="text-muted-foreground">Login</dt><dd className="font-medium">{typeof window !== "undefined" ? `${window.location.origin}/login` : "/login"}</dd>
              <dt className="text-muted-foreground">Email</dt><dd className="font-medium">{done.email}</dd>
              <dt className="text-muted-foreground">Password</dt><dd className="font-mono font-medium">{done.password}</dd>
            </dl>
            <DialogFooter>
              <Button variant="outline" onClick={copy}>{copied ? <><Check />Copied</> : <><Copy />Copy credentials</>}</Button>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1 text-sm">
              {([["create", "Create with password", KeyRound], ["invite", "Send email invitation", Mail]] as const).map(([m, label, Icon]) => (
                <button key={m} type="button" onClick={() => setMode(m)} className={cn("inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 font-medium transition-colors", mode === m ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground")}><Icon className="size-4" />{label}</button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{mode === "create" ? "The account is active immediately. You hand over the email and password." : "They receive an email link valid for 7 days to set their own password."}</p>
            {mode === "create" && (
              <Field label="Full name" htmlFor="inv-name" error={errors.name?.message}>
                <Input id="inv-name" placeholder="Priya Patel" aria-invalid={!!errors.name} {...register("name")} />
              </Field>
            )}
            <Field label="Email" htmlFor="inv-email" error={errors.email?.message}>
              <Input id="inv-email" type="email" placeholder="person@company.com" aria-invalid={!!errors.email} {...register("email")} />
            </Field>
            {mode === "create" && (
              <Field label="Password" htmlFor="inv-password" error={errors.password?.message} hint="At least 8 characters with a letter and a number.">
                <div className="flex gap-2">
                  <Input id="inv-password" type="text" autoComplete="off" className="font-mono" placeholder="Set or generate a password" aria-invalid={!!errors.password} {...register("password")} />
                  <Button type="button" variant="outline" onClick={() => setValue("password", generatePassword(), { shouldValidate: true })} title="Generate a password"><Wand2 />{password ? "Regenerate" : "Generate"}</Button>
                </div>
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Access role" htmlFor="inv-role" error={errors.role?.message} hint="What they can see and do.">
                <NativeSelect id="inv-role" {...register("role")}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</NativeSelect>
              </Field>
              <Field label="Designation" htmlFor="inv-designation" hint={designations.length === 0 ? (me.role === "COMPANY_ADMIN" ? "None defined yet - add them in Settings > Company." : "None defined yet - ask your admin.") : "Job title, e.g. Web Developer."}>
                <NativeSelect id="inv-designation" {...register("designation")} disabled={designations.length === 0}>
                  <option value="">No designation</option>
                  {designations.map((d) => <option key={d} value={d}>{d}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Team" htmlFor="inv-team" error={errors.teamId?.message} hint={me.role === "MANAGER" ? "Required: one of the teams you manage." : undefined}>
                <NativeSelect id="inv-team" {...register("teamId")}>
                  <option value="">No team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </NativeSelect>
              </Field>
            </div>
            {me.role === "COMPANY_ADMIN" && (
              <Field label="Reports to" htmlFor="inv-manager" error={errors.managerId?.message}>
                <NativeSelect id="inv-manager" {...register("managerId")}>
                  <option value="">No manager</option>
                  {managers.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.roleLabel})</option>)}
                </NativeSelect>
              </Field>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="submit" loading={isSubmitting}>{mode === "create" ? "Create account" : "Send invitation"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

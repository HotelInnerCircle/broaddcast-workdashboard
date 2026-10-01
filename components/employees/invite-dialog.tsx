"use client";
import { useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Check, Copy, IndianRupee, KeyRound, Mail, Wand2 } from "lucide-react";
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
import { can } from "@/lib/permissions";
import { SALARY_PARTS, amountsToNumbers, emptyAmounts, grossOfAmounts, money } from "@/components/payroll/salary-parts";
import { cn } from "@/lib/utils/cn";
import { ROLE_LABEL, type CompanyRole } from "@/types";
import type { EmployeeRow, TeamOption } from "./types";

type Mode = "create" | "invite";
/** One form for both modes: name/password are only validated (and sent) in "create" mode. */
type FormValues = CreateInviteInput & { name?: string; password?: string; designation?: string | null };
interface Credentials { name: string; email: string; password: string; role: string; employeeCode: string | null; gross: number | null; salaryError: string | null }

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
  // A83: HR is here too. HR itself may add people up to Manager, but never another HR or an admin.
  const roles: CompanyRole[] = me.role === "COMPANY_ADMIN"
    ? ["EMPLOYEE", "TEAM_LEAD", "MANAGER", "HR", "COMPANY_ADMIN"]
    : me.role === "HR"
      ? ["EMPLOYEE", "TEAM_LEAD", "MANAGER"]
      : ["EMPLOYEE", "TEAM_LEAD"];
  // A138: what they are paid, asked for here rather than on a register of its own.
  const canSetPay = can(me.role, "payslips", "update");
  const [mode, setMode] = useState<Mode>("create");
  const [done, setDone] = useState<Credentials | null>(null);
  const [copied, setCopied] = useState(false);
  const [pay, setPay] = useState(emptyAmounts);
  const [payFrom, setPayFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const payGross = grossOfAmounts(pay);
  const designations = useDesignations(open);
  const resolver = (mode === "create" ? zodResolver(createEmployeeSchema) : zodResolver(createInviteSchema)) as Resolver<FormValues>;
  const { register, handleSubmit, reset, setError, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver, defaultValues: { role: "EMPLOYEE", teamId: null, managerId: null, name: "", password: "", designation: null },
  });
  const password = watch("password");

  const close = () => { onOpenChange(false); setDone(null); setCopied(false); setPay(emptyAmounts()); reset(); };

  const onSubmit = async (values: FormValues) => {
    const body = {
      ...values, teamId: values.teamId || null, managerId: values.managerId || null, designation: values.designation || null,
      /*
       * Left out entirely unless something was typed: an untouched pay block
       * means "not agreed yet", which is a person without a salary rather than
       * a person on nothing. The server refuses a scale of zero either way.
       */
      salary: canSetPay && payGross > 0 ? { effectiveFrom: payFrom, ...amountsToNumbers(pay) } : null,
    };
    try {
      if (mode === "create") {
        const res = await api<{ name: string; email: string; role: CompanyRole; employeeCode: string | null; salary: { gross: number } | null; salaryError: string | null }>("/api/employees", { method: "POST", json: body });
        setDone({ name: res.name, email: res.email, password: values.password ?? "", role: ROLE_LABEL[res.role], employeeCode: res.employeeCode, gross: res.salary?.gross ?? null, salaryError: res.salaryError });
        if (res.salaryError) toast.error(`Account created, but the salary was not saved: ${res.salaryError}`);
        else toast.success(`Account created for ${res.name}`);
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

  // The pay is deliberately not in here: these get pasted into a chat window.
  const credentialsText = done
    ? `WorkPulse login for ${done.name} (${done.role})\nURL: ${window.location.origin}/login\nEmail: ${done.email}\nPassword: ${done.password}${done.employeeCode ? `\nEmployee ID: ${done.employeeCode}` : ""}`
    : "";
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
              {/* The code was assigned here and shown nowhere (A134/A138) - it is the
                  thing they will be asked for at a gate or on a form. */}
              {done.employeeCode && <><dt className="text-muted-foreground">Employee ID</dt><dd className="font-mono font-medium">{done.employeeCode}</dd></>}
              {done.gross !== null && <><dt className="text-muted-foreground">Salary</dt><dd className="font-medium">{money(done.gross)} a month</dd></>}
            </dl>
            {done.salaryError && (
              <p className="flex items-start gap-2 rounded-xl bg-warning-soft px-4 py-3 text-[13px] text-tile-warning-fg">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>The account is ready, but the salary was not saved: {done.salaryError}. Set it on their page.</span>
              </p>
            )}
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
            {/*
              Their salary, while they are being added (A138).

              This lived on a register of its own - a list of everybody with a
              pencil beside each name - so a new hire was created on one screen
              and paid on another, and the second step was the one people forgot
              until payroll skipped them. What somebody earns is agreed when they
              are hired, so it is asked for here.

              Optional on purpose: somebody can be given a login before the
              figure is settled, and the same fields are on their own page for
              the raise afterwards. Only shown to whoever may set pay at all -
              a manager adding to their team is not told what the team earns.
            */}
            {mode === "create" && canSetPay && (
              <div className="space-y-3 rounded-2xl border border-border bg-muted/40 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-[14px] font-semibold"><IndianRupee className="size-4" />Salary</h3>
                  <p className="text-[11.5px] text-muted-foreground">Optional - you can set it later on their page.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label htmlFor="inv-pay-from" className="text-[12.5px] font-semibold">Effective from</label>
                    <Input id="inv-pay-from" type="date" value={payFrom} onChange={(e) => setPayFrom(e.target.value)} />
                  </div>
                  {SALARY_PARTS.map((p) => (
                    <div key={p.key}>
                      <label htmlFor={`inv-pay-${p.key}`} className="text-[12.5px] font-semibold">{p.label}</label>
                      <Input
                        id={`inv-pay-${p.key}`} type="number" min={0} inputMode="numeric" placeholder="0"
                        value={pay[p.key]} onChange={(e) => setPay({ ...pay, [p.key]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[12.5px] text-muted-foreground">
                  {payGross > 0
                    ? <>Monthly gross <span className="font-display text-[18px] tabular-nums text-foreground">{money(payGross)}</span> &middot; a raise later is a new line, so this figure stays true on payslips already issued.</>
                    : <>Leave these blank to add them without a salary - payroll will list them as unpaid until one is set.</>}
                </p>
              </div>
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

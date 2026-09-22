"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Check, Copy, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/api/client";
import { createCompanySchema, type CreateCompanyInput } from "@/lib/validation/company";

interface PlanOption { id: string; name: string; price: number }
interface Created { id: string; name: string; admin: { name: string; email: string }; inviteLink: string | null; password?: string }

/** A readable 12-character password that satisfies the password rule (letter + number). */
function generatePassword() {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ", digits = "23456789", all = letters + digits;
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  return [pick(letters.toUpperCase()), pick(letters), pick(digits), ...Array.from({ length: 9 }, () => pick(all))].sort(() => Math.random() - 0.5).join("");
}

/** Super Admin creates a company and invites its first administrator (A55). */
export function NewCompanyButton({ plans }: { plans: PlanOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm<CreateCompanyInput>({ resolver: zodResolver(createCompanySchema), defaultValues: { timezone: "Asia/Kolkata", adminPassword: undefined } });
  const adminPassword = watch("adminPassword");

  const submit = async (values: CreateCompanyInput) => {
    try {
      const res = await api<Created>("/api/super-admin/companies", { method: "POST", json: { ...values, planId: values.planId || undefined, adminPassword: values.adminPassword || undefined } });
      setDone({ ...res, password: values.adminPassword || undefined });
      toast.success(res.inviteLink ? `${res.name} created - invitation sent to ${res.admin.email}` : `${res.name} created - hand the credentials to ${res.admin.name}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Could not create the company");
    }
  };
  const close = () => { setOpen(false); setDone(null); setCopied(false); reset(); };
  const handover = done ? (done.inviteLink ?? `WorkPulse login for ${done.admin.name} (Company Admin of ${done.name})
URL: ${window.location.origin}/login
Email: ${done.admin.email}
Password: ${done.password ?? ""}`) : "";
  const copy = async () => { if (!done) return; try { await navigator.clipboard.writeText(handover); setCopied(true); } catch { toast.error("Copy failed - select the link manually"); } };

  return (
    <>
      <Button onClick={() => setOpen(true)}><Building2 />New company</Button>
      <Dialog open={open} onOpenChange={(o) => !o && close()}>
        <DialogContent title={done ? "Company created" : "Create a company"} description={done ? undefined : "The first administrator receives an email invitation and sets their own password."}>
          {done ? (
            <div className="space-y-4">
              {done.inviteLink ? (
                <>
                  <p className="text-sm"><strong>{done.name}</strong> is ready. An invitation was emailed to <strong>{done.admin.email}</strong>. If email is not configured, share this link with them securely - it expires in 7 days.</p>
                  <div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2">
                    <code className="min-w-0 flex-1 truncate text-xs">{done.inviteLink}</code>
                    <Button size="sm" variant="outline" onClick={copy}>{copied ? <><Check />Copied</> : <><Copy />Copy</>}</Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm"><strong>{done.name}</strong> is ready. Share these credentials with <strong>{done.admin.name}</strong> privately - the password is shown only once.</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-xl bg-muted px-4 py-3 text-sm">
                    <dt className="text-muted-foreground">Login</dt><dd className="font-medium">{typeof window !== "undefined" ? `${window.location.origin}/login` : "/login"}</dd>
                    <dt className="text-muted-foreground">Email</dt><dd className="font-medium">{done.admin.email}</dd>
                    <dt className="text-muted-foreground">Password</dt><dd className="font-mono font-medium">{done.password}</dd>
                  </dl>
                  <Button size="sm" variant="outline" onClick={copy}>{copied ? <><Check />Copied</> : <><Copy />Copy credentials</>}</Button>
                </>
              )}
              <DialogFooter><Button onClick={close}>Done</Button></DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleSubmit(submit)} className="space-y-4">
              <Field label="Company name" htmlFor="nc-name" error={errors.name?.message}><Input id="nc-name" placeholder="Acme Studio" {...register("name")} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Administrator name" htmlFor="nc-admin" error={errors.adminName?.message}><Input id="nc-admin" placeholder="Full name" {...register("adminName")} /></Field>
                <Field label="Administrator email" htmlFor="nc-email" error={errors.adminEmail?.message}><Input id="nc-email" type="email" placeholder="admin@company.com" {...register("adminEmail")} /></Field>
              </div>
              <Field label="Administrator password (optional)" htmlFor="nc-password" error={errors.adminPassword?.message} hint="Leave empty to email an invitation instead. With a password the account is active immediately and you hand the credentials over.">
                <div className="flex gap-2">
                  <Input id="nc-password" type="text" autoComplete="off" className="font-mono" placeholder="Invite by email, or set a password" {...register("adminPassword", { setValueAs: (v: string) => (v ? v : undefined) })} />
                  <Button type="button" variant="outline" onClick={() => setValue("adminPassword", generatePassword(), { shouldValidate: true })}><Wand2 />{adminPassword ? "Regenerate" : "Generate"}</Button>
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Plan" htmlFor="nc-plan" hint="Leave on default to use the platform's default plan."><NativeSelect id="nc-plan" {...register("planId")}><option value="">Default plan</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} - INR {p.price}/mo</option>)}</NativeSelect></Field>
                <Field label="Timezone" htmlFor="nc-tz" error={errors.timezone?.message}><Input id="nc-tz" placeholder="Asia/Kolkata" {...register("timezone")} /></Field>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                <Button type="submit" loading={isSubmitting}>{adminPassword ? "Create company" : "Create and invite"}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Irreversible: the Super Admin must type the company name to delete it and all of its data (A55). */
export function DeleteCompanyDialog({ company, open, onOpenChange, onDeleted }: { company: { id: string; name: string } | null; open: boolean; onOpenChange: (o: boolean) => void; onDeleted?: (id: string) => void }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = Boolean(company) && confirm.trim().toLowerCase() === company!.name.trim().toLowerCase();
  const close = () => { onOpenChange(false); setConfirm(""); };
  const run = async () => {
    if (!company || !matches) return;
    setBusy(true);
    try {
      const res = await api<{ deleted: Record<string, number> }>(`/api/super-admin/companies/${company.id}`, { method: "DELETE", json: { confirmName: confirm.trim() } });
      const users = res.deleted.users ?? 0;
      toast.success(`${company.name} deleted (${users} user${users === 1 ? "" : "s"} removed)`);
      onDeleted?.(company.id);
      close();
      router.push("/super-admin/companies");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Could not delete the company");
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent title="Delete company" description="This permanently removes the company, every user, session, client, project, task, time entry, message and uploaded file. It cannot be undone.">
        <Field label={`Type "${company?.name ?? ""}" to confirm`} htmlFor="dc-confirm"><Input id="dc-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" placeholder={company?.name} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button variant="danger" disabled={!matches} loading={busy} onClick={run}><Trash2 />Delete permanently</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

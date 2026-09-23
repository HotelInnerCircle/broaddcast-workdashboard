"use client";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/api/client";
import { showLimitError } from "@/lib/api/limit-toast";
import { useCompanyServices } from "@/hooks/usePickers";
import { cn } from "@/lib/utils/cn";
import type { ClientRow } from "@/components/tasks/types";

const schema = z.object({
  name: z.string().trim().min(2, "Client name is too short").max(120),
  contactPerson: z.string().max(120).optional(),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional(),
  phone: z.string().max(30).optional(),
  website: z.string().max(200).optional(),
  industry: z.string().max(80).optional(),
  status: z.enum(["active", "inactive"]),
  notes: z.string().max(5000).optional(),
});
type Input = z.infer<typeof schema>;

export function ClientDialog({ client, open, onClose, onSaved }: { client: ClientRow | null; open: boolean; onClose: () => void; onSaved: (c: ClientRow) => void }) {
  // Services this client has taken (A69). The catalogue is maintained in Settings > Company.
  const catalogue = useCompanyServices(open);
  const [services, setServices] = useState<string[]>([]);
  const toggle = (s: string) => setServices((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<Input>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (!open) return;
    setServices(client?.services ?? []);
    reset(client
      ? { name: client.name, contactPerson: client.contactPerson ?? "", email: client.email ?? "", phone: client.phone ?? "", website: client.website ?? "", industry: client.industry ?? "", status: client.status as "active" | "inactive", notes: client.notes ?? "" }
      : { name: "", contactPerson: "", email: "", phone: "", website: "", industry: "", status: "active", notes: "" });
  }, [client, open, reset]);

  const onSubmit = async (v: Input) => {
    const body = { ...v, contactPerson: v.contactPerson || null, email: v.email || null, phone: v.phone || null, website: v.website || null, industry: v.industry || null, services, notes: v.notes || null };
    try {
      const saved = client ? await api<ClientRow>(`/api/clients/${client.id}`, { method: "PATCH", json: body }) : await api<ClientRow>("/api/clients", { method: "POST", json: body });
      toast.success(client ? "Client updated" : "Client created");
      onSaved(saved); onClose();
    } catch (e) {
      if (e instanceof ClientApiError && e.code === "CLIENT_EXISTS") setError("name", { message: e.message });
      else if (showLimitError(e)) { /* upgrade prompt shown */ }
      else toast.error(e instanceof ClientApiError ? e.message : "Could not save client");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={client ? "Edit client" : "New client"} description="Clients own projects; every timer is tracked against a client.">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Company name" htmlFor="cl-name" error={errors.name?.message}><Input id="cl-name" autoFocus {...register("name")} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Contact person" htmlFor="cl-contact"><Input id="cl-contact" {...register("contactPerson")} /></Field>
            <Field label="Email" htmlFor="cl-email" error={errors.email?.message}><Input id="cl-email" type="email" {...register("email")} /></Field>
            <Field label="Phone" htmlFor="cl-phone"><Input id="cl-phone" {...register("phone")} /></Field>
            <Field label="Website" htmlFor="cl-web"><Input id="cl-web" placeholder="https://" {...register("website")} /></Field>
            <Field label="Industry" htmlFor="cl-ind"><Input id="cl-ind" {...register("industry")} /></Field>
            <Field label="Status" htmlFor="cl-status"><NativeSelect id="cl-status" {...register("status")}><option value="active">Active</option><option value="inactive">Inactive</option></NativeSelect></Field>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium leading-none text-foreground">What have they taken from us?</legend>
            {catalogue.length === 0 ? (
              <p className="text-xs text-muted-foreground">No services defined yet. Add them in Settings &gt; Company &gt; Services you offer.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {[...catalogue, ...services.filter((s) => !catalogue.includes(s))].map((s) => {
                  const on = services.includes(s);
                  return (
                    <label key={s} className={cn("flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors", on ? "bg-primary-soft font-medium text-primary ring-1 ring-primary/30" : "bg-muted/60 hover:bg-muted")}>
                      <input type="checkbox" className="size-4 accent-primary" checked={on} onChange={() => toggle(s)} />
                      <span className="truncate">{s}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
          <Field label="Notes" htmlFor="cl-notes"><Textarea id="cl-notes" rows={3} {...register("notes")} /></Field>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>{client ? "Save changes" : "Create client"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

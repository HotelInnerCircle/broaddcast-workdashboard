"use client";
import { useEffect } from "react";
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
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm<Input>({ resolver: zodResolver(schema) });
  useEffect(() => {
    if (!open) return;
    reset(client
      ? { name: client.name, contactPerson: client.contactPerson ?? "", email: client.email ?? "", phone: client.phone ?? "", website: client.website ?? "", industry: client.industry ?? "", status: client.status as "active" | "inactive", notes: client.notes ?? "" }
      : { name: "", contactPerson: "", email: "", phone: "", website: "", industry: "", status: "active", notes: "" });
  }, [client, open, reset]);

  const onSubmit = async (v: Input) => {
    const body = { ...v, contactPerson: v.contactPerson || null, email: v.email || null, phone: v.phone || null, website: v.website || null, industry: v.industry || null, notes: v.notes || null };
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
          <Field label="Notes" htmlFor="cl-notes"><Textarea id="cl-notes" rows={3} {...register("notes")} /></Field>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" loading={isSubmitting}>{client ? "Save changes" : "Create client"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

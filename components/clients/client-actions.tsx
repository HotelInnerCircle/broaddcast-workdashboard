"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, ClientApiError } from "@/lib/api/client";
import { ClientDialog } from "./client-dialog";
import type { ClientRow } from "@/components/tasks/types";

export function ClientActions({ client }: { client: ClientRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const toggleArchive = async () => {
    const archiving = !client.archivedAt;
    if (archiving && !confirm(`Archive ${client.name}? It disappears from pickers and lists but all history is kept.`)) return;
    try {
      await api(`/api/clients/${client.id}`, { method: "PATCH", json: { archived: archiving } });
      toast.success(archiving ? "Client archived" : "Client restored");
      router.refresh();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Action failed"); }
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Pencil />Edit</Button>
      <Button variant="ghost" size="sm" onClick={toggleArchive}>{client.archivedAt ? <><ArchiveRestore />Restore</> : <><Archive />Archive</>}</Button>
      <ClientDialog client={client} open={open} onClose={() => setOpen(false)} onSaved={() => router.refresh()} />
    </>
  );
}

import { requirePagePermission } from "@/lib/auth/context";
import { ClientsView } from "@/components/clients/clients-view";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  await requirePagePermission("clients", "view");
  return <ClientsView />;
}

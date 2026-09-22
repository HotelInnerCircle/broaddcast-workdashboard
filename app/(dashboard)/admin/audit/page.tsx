import { requirePagePermission } from "@/lib/auth/context";
import { AuditViewer } from "@/components/admin/audit-viewer";

export const metadata = { title: "Audit log" };

export default async function AdminAuditPage() {
  await requirePagePermission("auditLog", "view");
  return <AuditViewer />;
}

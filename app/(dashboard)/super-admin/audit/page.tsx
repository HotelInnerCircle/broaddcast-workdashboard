import { requirePageRole } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { Company } from "@/models/Company";
import { AuditViewer } from "@/components/admin/audit-viewer";

export const metadata = { title: "Platform audit log" };

export default async function PlatformAuditPage() {
  await requirePageRole("SUPER_ADMIN");
  await connectDB();
  const companies = (await Company.find().select("name").sort({ name: 1 }).lean()).map((c) => ({ id: String(c._id), name: c.name }));
  return <AuditViewer platform companies={companies} />;
}

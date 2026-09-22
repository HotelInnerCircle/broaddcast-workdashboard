import { requirePageRole } from "@/lib/auth/context";
import { PlansEditor } from "@/components/super-admin/plans-editor";

export const metadata = { title: "Plans" };

export default async function PlansPage() {
  await requirePageRole("SUPER_ADMIN");
  return <PlansEditor />;
}

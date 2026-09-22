import { requirePageSession } from "@/lib/auth/context";
import { redirect } from "next/navigation";
import { NotificationsView } from "@/components/layout/notifications-view";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const ctx = await requirePageSession();
  if (!ctx.companyId) redirect("/super-admin/dashboard");
  return <NotificationsView />;
}

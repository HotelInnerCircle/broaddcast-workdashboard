import { Suspense } from "react";
import { requirePagePermission } from "@/lib/auth/context";
import { AnnouncementsView } from "@/components/announcements/announcements-view";
import { DashboardLoading } from "@/components/skeletons/dashboard-loading";

export const metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  await requirePagePermission("announcements", "view");
  return <Suspense fallback={<DashboardLoading />}><AnnouncementsView /></Suspense>;
}

import { Suspense } from "react";
import { requirePagePermission } from "@/lib/auth/context";
import { ProjectsView } from "@/components/projects/projects-view";
import { DashboardLoading } from "@/components/skeletons/dashboard-loading";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
  await requirePagePermission("projects", "view");
  return <Suspense fallback={<DashboardLoading />}><ProjectsView /></Suspense>;
}

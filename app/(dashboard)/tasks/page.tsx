import { Suspense } from "react";
import { requirePagePermission } from "@/lib/auth/context";
import { TasksView } from "@/components/tasks/tasks-view";
import { DashboardLoading } from "@/components/skeletons/dashboard-loading";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  await requirePagePermission("tasks", "view");
  return <Suspense fallback={<DashboardLoading />}><TasksView /></Suspense>;
}

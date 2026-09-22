import { notFound } from "next/navigation";
import { requirePagePermission, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { ApiError } from "@/lib/api/errors";
import { getTask } from "@/services/taskService";
import { TaskDetailView } from "@/components/tasks/task-detail";
import type { TaskDetail } from "@/components/tasks/types";

export const metadata = { title: "Task" };

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = (await requirePagePermission("tasks", "view")) as CompanyContext;
  const { id } = await params;
  await connectDB();
  try {
    const task = await getTask(ctx, id);
    return <TaskDetailView task={JSON.parse(JSON.stringify(task)) as TaskDetail} />;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

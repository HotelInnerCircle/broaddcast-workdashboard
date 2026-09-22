import { Badge } from "@/components/ui/badge";

const TASK: Record<string, "default" | "primary" | "success" | "warning" | "danger" | "info" | "outline"> = {
  Backlog: "outline", "To Do": "default", "In Progress": "info", Review: "primary", Completed: "success", Blocked: "danger", "On Hold": "warning", Cancelled: "outline",
};
const PROJECT: Record<string, "default" | "primary" | "success" | "warning" | "danger" | "info" | "outline"> = {
  Planning: "default", Active: "info", "On Hold": "warning", Completed: "success", Cancelled: "outline",
};
const PRIORITY: Record<string, "default" | "primary" | "success" | "warning" | "danger" | "info" | "outline"> = {
  Low: "outline", Medium: "default", High: "warning", Urgent: "danger",
};

export function TaskStatusBadge({ status }: { status: string }) { return <Badge variant={TASK[status] ?? "default"}>{status}</Badge>; }
export function ProjectStatusBadge({ status }: { status: string }) { return <Badge variant={PROJECT[status] ?? "default"}>{status}</Badge>; }
export function PriorityBadge({ priority }: { priority: string }) { return <Badge variant={PRIORITY[priority] ?? "default"}>{priority}</Badge>; }
export function ClientStatusBadge({ status, archived }: { status: string; archived?: boolean }) {
  if (archived) return <Badge variant="outline">Archived</Badge>;
  return <Badge variant={status === "active" ? "success" : "warning"}>{status}</Badge>;
}

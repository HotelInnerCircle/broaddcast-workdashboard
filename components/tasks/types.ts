export interface Ref { id: string; name: string | null }
export interface Person { id: string; name: string; avatarUrl: string | null }

export interface TaskRow {
  id: string; title: string; description: string | null; status: string; priority: string; client: Ref | null; project: Ref | null;
  assignee: Person | null; assignedTo: string | null; createdBy: string | null; dueDate: string | null; dueKey: string | null; overdue: boolean;
  estimatedMinutes: number | null; actualMinutes: number; attachmentCount: number; completedAt: string | null; archivedAt: string | null; createdAt: string; updatedAt: string;
}
export interface Attachment { id: string; name: string; size: number; mime: string; uploadedBy: string; createdAt: string; url: string }
export interface ActivityItem { id: string; action: string; summary: string | null; actorName: string | null; createdAt: string }
export interface TaskDetail extends TaskRow { creator: Person | null; attachments: Attachment[]; activity: ActivityItem[]; permissions: { canEdit: boolean; canAssign: boolean; canChangeStatus: boolean } }

export interface ProjectProgress { total: number; completed: number; cancelled: number; overdue: number; open: number; progress: number; estimatedMinutes: number; actualMinutes: number }
export interface ProjectRow {
  id: string; name: string; description: string | null; client: Ref | null; manager: Person | null; memberIds: string[]; members: Person[];
  startDate: string | null; startKey: string | null; deadline: string | null; deadlineKey: string | null; daysRemaining: number | null; status: string; priority: string; budget: number | null; estimatedHours: number | null;
  archivedAt: string | null; createdAt: string; updatedAt: string; progress: ProjectProgress;
}
export interface ClientRow {
  id: string; name: string; contactPerson: string | null; email: string | null; phone: string | null; website: string | null; industry: string | null;
  status: string; notes: string | null; archivedAt: string | null; createdAt: string; updatedAt: string; projects?: number; activeProjects?: number; openTasks?: number;
}
export interface CalendarEvent { id: string; kind: "task" | "deadline" | "start"; date: string; title: string; subtitle: string | null; status: string; priority: string | null; overdue: boolean; href: string }

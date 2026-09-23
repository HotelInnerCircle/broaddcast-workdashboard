export const ROLES = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "TEAM_LEAD", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];
export const COMPANY_ROLES = ["COMPANY_ADMIN", "MANAGER", "TEAM_LEAD", "EMPLOYEE"] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const USER_STATUSES = ["active", "invited", "deactivated"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const COMPANY_STATUSES = ["active", "suspended"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const INVITE_STATUSES = ["pending", "accepted", "revoked"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const PLAN_NAMES = ["Starter", "Business", "Enterprise"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Authenticated request context. companyId is null only for SUPER_ADMIN. */
export interface SessionContext {
  sessionId: string;
  userId: string;
  companyId: string | null;
  role: Role;
  name: string;
  email: string;
  avatarUrl: string | null;
  teamId: string | null;
  managerId: string | null;
  company: {
    id: string;
    name: string;
    logoUrl: string | null;
    timezone: string;
    currency: string;
    setupCompleted: boolean;
    /** Menu items hidden for this user's role (A71): nav hrefs. */
    hiddenNav: string[];
  } | null;
}

export const ROLE_HOME: Record<Role, string> = {
  SUPER_ADMIN: "/super-admin/dashboard",
  COMPANY_ADMIN: "/admin/dashboard",
  MANAGER: "/manager/dashboard",
  TEAM_LEAD: "/team/dashboard",
  EMPLOYEE: "/employee/dashboard",
};

export const ROLE_LABEL: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  COMPANY_ADMIN: "Company Admin",
  MANAGER: "Manager",
  TEAM_LEAD: "Team Lead",
  EMPLOYEE: "Employee",
};

export const CLIENT_STATUSES = ["active", "inactive"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const PROJECT_STATUSES = ["Planning", "Active", "On Hold", "Completed", "Cancelled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ["Backlog", "To Do", "In Progress", "Review", "Completed", "Blocked", "On Hold", "Cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** Kanban columns (spec 12.9). Other statuses are reachable from the list/detail views. */
export const KANBAN_COLUMNS = ["Backlog", "To Do", "In Progress", "Review", "Completed"] as const;
/** Statuses that count as "closed" for overdue and progress math (spec 7.7, 12.11). */
export const TASK_DONE_STATUSES: TaskStatus[] = ["Completed", "Cancelled"];

export const TIME_ENTRY_STATUSES = ["RUNNING", "PAUSED", "COMPLETED"] as const;
export type TimeEntryStatus = (typeof TIME_ENTRY_STATUSES)[number];

export const ATTENDANCE_STATUSES = ["Present", "Late", "Half Day", "Absent", "Leave"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** Presence colours (spec 7.6). */
export type Presence = "working" | "break" | "online" | "offline";

export const NOTIFICATION_TYPES = ["TASK_ASSIGNED", "TASK_COMPLETED", "TASK_OVERDUE", "TASK_COMMENT", "MENTION", "MESSAGE", "PROJECT_UPDATE", "DEADLINE", "TIMER", "ANNOUNCEMENT"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const CONVERSATION_TYPES = ["dm", "team", "project"] as const;
export type ConversationType = (typeof CONVERSATION_TYPES)[number];

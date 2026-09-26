import type { Role } from "@/types";

/**
 * THE permission matrix (spec section 4.5 / 5). Pure data: role -> resource -> grant.
 * Read by the sidebar (show/hide), the Roles page (rendered read-only) and the API (enforced).
 *
 * scope semantics:
 *  - company : everything inside the company
 *  - scope   : a manager's scope (teams they manage + their direct reports)
 *  - team    : the user's own team
 *  - own     : records that belong to / are assigned to the user
 */
export const RESOURCES = [
  "companies", "systemAnalytics", "companySettings", "billing", "employees", "teams", "clients",
  "projects", "tasks", "reports", "liveStatus", "timer", "attendance", "chat", "announcements",
  "dailyReports", "auditLog", "roles", "workSites", "scheduling", "payslips",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ["view", "create", "update", "archive", "assign", "invite", "manage"] as const;
export type Action = (typeof ACTIONS)[number];

export type Scope = "company" | "scope" | "team" | "own" | "assigned";
export interface Grant { actions: Action[]; scope: Scope }

const ALL: Action[] = ["view", "create", "update", "archive", "assign", "invite", "manage"];
const RW: Action[] = ["view", "create", "update", "archive"];
const g = (actions: Action[], scope: Scope): Grant => ({ actions, scope });

export const PERMISSIONS: Record<Role, Partial<Record<Resource, Grant>>> = {
  SUPER_ADMIN: {
    companies: g(ALL, "company"),
    systemAnalytics: g(["view"], "company"),
    auditLog: g(["view"], "company"),
    roles: g(["view"], "company"),
  },
  COMPANY_ADMIN: {
    companySettings: g(["view", "update"], "company"),
    billing: g(["view", "manage"], "company"),
    employees: g(ALL, "company"),
    teams: g(ALL, "company"),
    clients: g(RW, "company"), // A70: admins add clients too; theirs are shared company-wide
    projects: g([...RW, "assign"], "company"),
    tasks: g([...RW, "assign"], "company"),
    reports: g(["view"], "company"),
    liveStatus: g(["view"], "company"),
    timer: g(["view", "create", "update"], "own"),
    attendance: g(["view", "create", "update"], "company"),
    workSites: g(ALL, "company"),
    scheduling: g(ALL, "company"),
    chat: g(["view", "create", "manage"], "company"), // manage = create/edit channels (A72)
    announcements: g(["view", "create"], "company"),
    dailyReports: g(["view", "create"], "company"),
    auditLog: g(["view"], "company"),
    /**
     * Payroll is HR and the company admin only (A102). Everybody can read their
     * own payslip without a grant - that is handled in the route, the way a
     * person's own profile is - because a grant here would mean "everybody's".
     */
    payslips: g(ALL, "company"),
    roles: g(["view"], "company"),
  },
  /**
   * HR (A83): people and attendance across the whole company, and the only role besides the
   * Company Admin that defines the work sites a swipe is measured against. Deliberately has no
   * grant over clients, projects or tasks - that is not what HR is for, and the default scope
   * elsewhere keeps them out of it.
   */
  HR: {
    employees: g(["view", "invite", "update"], "company"),
    teams: g(["view"], "company"),
    reports: g(["view"], "company"),
    liveStatus: g(["view"], "company"),
    timer: g(["view", "create", "update"], "own"),
    attendance: g(["view", "create", "update"], "company"),
    workSites: g(ALL, "company"),
    scheduling: g(ALL, "company"),
    chat: g(["view", "create"], "company"),
    announcements: g(["view", "create"], "company"),
    dailyReports: g(["view"], "company"),
    payslips: g(ALL, "company"),
    roles: g(["view"], "company"),
  },
  MANAGER: {
    employees: g(["view", "invite", "update"], "scope"),
    teams: g(["view", "create", "update"], "scope"),
    clients: g(RW, "scope"), // A61: own clients (+ legacy unowned); visible to everyone under the manager
    projects: g([...RW, "assign"], "company"),
    tasks: g([...RW, "assign"], "company"),
    reports: g(["view"], "company"),
    liveStatus: g(["view"], "scope"),
    timer: g(["view", "create", "update"], "own"),
    attendance: g(["view", "create", "update"], "scope"),
    chat: g(["view", "create", "manage"], "company"), // manage = create/edit channels (A72)
    announcements: g(["view", "create"], "company"),
    dailyReports: g(["view", "create"], "company"),
    roles: g(["view"], "company"),
  },
  TEAM_LEAD: {
    employees: g(["view"], "team"),
    teams: g(["view", "update"], "team"),
    clients: g(["view"], "company"),
    projects: g(["view"], "team"),
    tasks: g([...RW, "assign"], "team"),
    reports: g(["view"], "team"),
    liveStatus: g(["view"], "team"),
    timer: g(["view", "create", "update"], "own"),
    attendance: g(["view", "create"], "own"),
    chat: g(["view", "create", "manage"], "company"), // manage = create/edit channels for their team (A72)
    announcements: g(["view"], "company"),
    dailyReports: g(["view", "create"], "team"),
    roles: g(["view"], "company"),
  },
  EMPLOYEE: {
    clients: g(["view"], "assigned"),
    projects: g(["view"], "assigned"),
    tasks: g(["view", "update"], "own"),
    reports: g(["view"], "own"),
    timer: g(["view", "create", "update"], "own"),
    attendance: g(["view", "create"], "own"),
    chat: g(["view", "create"], "company"),
    announcements: g(["view"], "company"),
    dailyReports: g(["view", "create"], "own"),
    roles: g(["view"], "company"),
  },
};

export function can(role: Role, resource: Resource, action: Action): boolean {
  return PERMISSIONS[role]?.[resource]?.actions.includes(action) ?? false;
}

export function scopeOf(role: Role, resource: Resource): Scope | null {
  return PERMISSIONS[role]?.[resource]?.scope ?? null;
}

/** Human labels for the read-only Roles page. */
export const RESOURCE_LABEL: Record<Resource, string> = {
  companies: "Companies, plans & suspensions",
  systemAnalytics: "System-level analytics",
  companySettings: "Company settings",
  billing: "Subscription & billing",
  employees: "Employees & managers",
  teams: "Teams",
  clients: "Clients",
  projects: "Projects",
  tasks: "Tasks",
  reports: "Reports",
  liveStatus: "Live employee status",
  payslips: "Payslips",
  timer: "Timer / timesheet",
  attendance: "Attendance",
  chat: "Chat",
  announcements: "Announcements",
  dailyReports: "Daily work reports",
  auditLog: "Audit log",
  roles: "Roles matrix",
  workSites: "Work sites (attendance geofence)",
  scheduling: "Shifts, timings and holidays",
};

export const SCOPE_LABEL: Record<Scope, string> = {
  company: "company-wide",
  scope: "within managed scope",
  team: "own team",
  own: "own data",
  assigned: "assigned only",
};

import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, ListChecks, FolderKanban, Building2, CalendarDays, Timer, Table2, CalendarCheck, Users, UsersRound,
  ShieldCheck, MessageSquare, Fingerprint, ClipboardCheck, MapPin, CalendarClock, Palmtree, Bell, Megaphone, BarChart3, Clock, Briefcase, PieChart, Settings, CreditCard, Receipt, Globe, FileText, ScrollText, Eye, ClipboardList,
} from "lucide-react";
import { can, type Action, type Resource } from "@/lib/permissions";
import { ROLE_HOME, type Role } from "@/types";

export interface NavItem { label: string; href: string; icon: LucideIcon; permission?: [Resource, Action]; roles?: Role[]; phase?: number }
export interface NavGroup { label: string; items: NavItem[] }

/**
 * Sidebar groups (spec section 11). Items are filtered by the permission matrix, then by the
 * company's per-role menu visibility (A71): `hidden` holds the hrefs an admin has switched off.
 * "Menu visibility" itself is never hidden, so an admin can always switch things back on.
 */
const ALWAYS_VISIBLE = ["/admin/navigation"];

export function navigationFor(role: Role, hidden: string[] = []): NavGroup[] {
  if (role === "SUPER_ADMIN") {
    return [
      { label: "PLATFORM", items: [
        { label: "Dashboard", href: "/super-admin/dashboard", icon: LayoutDashboard },
        { label: "Companies", href: "/super-admin/companies", icon: Globe },
        { label: "Plans", href: "/super-admin/plans", icon: CreditCard },
        { label: "Audit log", href: "/super-admin/audit", icon: ScrollText },
        { label: "Roles", href: "/roles", icon: ShieldCheck },
      ] },
    ];
  }
  const groups: NavGroup[] = [
    { label: "WORKSPACE", items: [
      { label: "Dashboard", href: ROLE_HOME[role], icon: LayoutDashboard },
      { label: role === "EMPLOYEE" ? "My Tasks" : "Tasks", href: "/tasks", icon: ListChecks, permission: ["tasks", "view"] },
      { label: "Projects", href: "/projects", icon: FolderKanban, permission: ["projects", "view"] },
      { label: "Clients", href: "/clients", icon: Building2, permission: ["clients", "view"] },
      { label: "Calendar", href: "/calendar", icon: CalendarDays, permission: ["tasks", "view"] },
    ] },
    { label: "TIME", items: [
      { label: "Timer", href: "/timer", icon: Timer, permission: ["timer", "view"] },
      { label: "Timesheets", href: "/timesheets", icon: Table2, permission: ["timer", "view"] },
      { label: "Attendance", href: "/attendance", icon: CalendarCheck, permission: ["attendance", "view"] },
      // A83: swiping is its own screen - it needs the camera and a location fix, which the
      // attendance table has no business asking for.
      { label: "Swipe", href: "/swipe", icon: Fingerprint, permission: ["attendance", "create"] },
      { label: "Leave", href: "/leave", icon: Palmtree, permission: ["attendance", "create"] },
      { label: "Swipe approvals", href: "/attendance/swipes", icon: ClipboardCheck, permission: ["attendance", "view"], roles: ["COMPANY_ADMIN", "HR", "MANAGER", "TEAM_LEAD"] },
      { label: "Daily Report", href: "/daily-report", icon: FileText, permission: ["dailyReports", "create"] },
    ] },
    { label: "TEAM", items: [
      { label: "Employees", href: "/employees", icon: Users, permission: ["employees", "view"] },
      { label: "Teams", href: "/teams", icon: UsersRound, permission: ["teams", "view"] },
      { label: "Roles", href: "/roles", icon: ShieldCheck, permission: ["roles", "view"] },
      // A78: the team's daily reports. Employees are excluded - "Daily Report" under TIME is their
      // own submission, and this page would only ever show them their own row again.
      { label: "Daily Reports", href: "/reports/daily", icon: ClipboardList, permission: ["dailyReports", "view"], roles: ["COMPANY_ADMIN", "HR", "MANAGER", "TEAM_LEAD"] },
    ] },
    { label: "COMMUNICATION", items: [
      { label: "Chat", href: "/chat", icon: MessageSquare, permission: ["chat", "view"] },
      { label: "Notifications", href: "/notifications", icon: Bell },
      { label: "Announcements", href: "/announcements", icon: Megaphone, permission: ["announcements", "view"] },
    ] },
    { label: "ANALYTICS", items: [
      { label: "Reports", href: "/reports", icon: BarChart3, permission: ["reports", "view"] },
      { label: "Time Reports", href: "/reports/time", icon: Clock, permission: ["reports", "view"] },
      { label: "Client Reports", href: "/reports/clients", icon: Briefcase, permission: ["reports", "view"], roles: ["COMPANY_ADMIN", "MANAGER"] },
      { label: "Project Reports", href: "/reports/projects", icon: PieChart, permission: ["reports", "view"], roles: ["COMPANY_ADMIN", "MANAGER", "TEAM_LEAD"] },
    ] },
    { label: "ADMIN", items: [
      { label: "Shifts & holidays", href: "/scheduling", icon: CalendarClock, permission: ["scheduling", "manage"] },
      { label: "Work sites", href: "/work-sites", icon: MapPin, permission: ["workSites", "manage"] },
      { label: "Settings", href: "/settings", icon: Settings, permission: ["companySettings", "view"] },
      { label: "Subscription", href: "/settings?tab=subscription", icon: CreditCard, permission: ["billing", "view"] },
      { label: "Billing", href: "/settings?tab=billing", icon: Receipt, permission: ["billing", "view"] },
      { label: "Audit log", href: "/admin/audit", icon: ScrollText, permission: ["auditLog", "view"], roles: ["COMPANY_ADMIN"] },
      { label: "Menu visibility", href: "/admin/navigation", icon: Eye, permission: ["companySettings", "update"], roles: ["COMPANY_ADMIN"] },
    ] },
  ];
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => (!i.permission || can(role, ...i.permission)) && (!i.roles || i.roles.includes(role)) && (ALWAYS_VISIBLE.includes(i.href) || !hidden.includes(i.href))) }))
    .filter((g) => g.items.length > 0);
}

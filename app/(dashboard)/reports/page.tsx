import Link from "next/link";
import { Users, Clock, ListChecks, FolderKanban, Building2, CalendarCheck, FileText, ArrowRight } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { can } from "@/lib/permissions";

export const metadata = { title: "Reports" };

const REPORTS = [
  { href: "/reports/employees", icon: Users, title: "Employee report", text: "Tracked hours, tasks completed and overdue, estimated vs actual, projects and clients worked, daily reports, attendance." },
  { href: "/reports/time", icon: Clock, title: "Time report", text: "Hours by day, employee, client and project. Reconciles exactly with timesheets." },
  { href: "/reports/tasks", icon: ListChecks, title: "Task report", text: "Task counts by status and priority, completions, overdue and tracked time." },
  { href: "/reports/projects", icon: FolderKanban, title: "Project report", text: "Tasks total / completed / pending / overdue and tracked vs estimated hours." },
  { href: "/reports/clients", icon: Building2, title: "Client report", text: "Totals per client, per-employee contribution and work over time." },
  { href: "/reports/attendance", icon: CalendarCheck, title: "Attendance report", text: "Present, late, half day, absent and leave per employee." },
  { href: "/reports/daily", icon: FileText, title: "Daily reports", text: "Each person's daily work report beside their tracked hours." },
];

export default async function ReportsHubPage() {
  const ctx = await requirePagePermission("reports", "view");
  const items = REPORTS.filter((r) => r.href !== "/reports/daily" || can(ctx.role, "dailyReports", "view"));
  const scope = ctx.role === "EMPLOYEE" ? "Your own data only." : ctx.role === "TEAM_LEAD" ? "Scoped to your team." : "Company-wide.";
  return (
    <>
      <PageHeader title="Reports" description={`Transparent numbers, filterable by date, employee, team, client and project. Export any report as CSV, Excel or PDF. ${scope}`} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((r) => (
          <Link key={r.href} href={r.href} className="group">
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="flex h-full flex-col gap-3 p-5">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary"><r.icon className="size-5" /></div>
                <p className="font-semibold group-hover:text-primary">{r.title}</p>
                <p className="flex-1 text-sm text-muted-foreground">{r.text}</p>
                <span className="inline-flex items-center gap-1 text-sm text-primary">Open <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

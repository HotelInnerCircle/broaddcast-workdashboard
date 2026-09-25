import { Users, Activity } from "lucide-react";
import { requirePageRole, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { scopeCounts, teamStatusRows } from "@/services/dashboardService";
import { Greeting } from "@/components/dashboard/greeting";
import { MobileHome } from "@/components/dashboard/mobile-home";
import { DayHero } from "@/components/dashboard/day-hero";
import { QuickTiles, type LauncherTile } from "@/components/dashboard/tiles";
import { StatsCard } from "@/components/dashboard/stats-card";
import { LiveStatus } from "@/components/dashboard/live-status";

export const metadata = { title: "HR dashboard" };

export default async function HrDashboardPage() {
  const ctx = (await requirePageRole("HR")) as CompanyContext;
  await connectDB();
  const [counts, rows] = await Promise.all([scopeCounts(ctx), teamStatusRows(ctx)]);
  const working = rows.filter((r) => r.presence === "working").length;
  const onBreak = rows.filter((r) => r.presence === "break").length;
  const online = rows.filter((r) => r.presence === "online").length;

  /** A83: HR's launcher. People and attendance, not projects and tasks. */
  const hrTiles: LauncherTile[] = [
    { href: "/employees", label: "People", icon: "people", tone: "work", hint: `${counts.total} in the company` },
    { href: "/attendance", label: "Attendance", icon: "attendance", tone: "time-3", hint: `${working} working now` },
    { href: "/teams", label: "Teams", icon: "teams", tone: "work-2", hint: "who reports to whom" },
    { href: "/reports/daily", label: "Daily reports", icon: "report", tone: "admin", hint: "what people did" },
    { href: "/reports", label: "Reports", icon: "reports", tone: "admin-2", hint: "hours and output" },
    { href: "/timer", label: "Timer", icon: "timer", tone: "time", hint: "track your own time" },
    { href: "/chat", label: "Chat", icon: "chat", tone: "muted", hint: "your colleagues" },
  ];

  return (
    <>
      <MobileHome tiles={hrTiles} timezone={ctx.company!.timezone} />

      <div className="hidden md:block">
        <Greeting name={ctx.name} timezone={ctx.company!.timezone} subtitle="People and attendance" />
        <div className="mb-4 mt-5"><DayHero /></div>
        <QuickTiles tiles={hrTiles} className="mb-6" />

        <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
          <StatsCard label="Total employees" value={counts.total} hint="in the company" icon={Users} />
          <StatsCard label="Currently working" value={working} hint="timer running" icon={Activity} tone="success" />
          <StatsCard label="On break" value={onBreak} tone="warning" />
          <StatsCard label="Online" value={online} hint="active in last 5 min" tone="info" />
          <StatsCard label="Offline" value={Math.max(0, rows.length - working - onBreak - online)} tone="muted" />
        </div>

        <div className="mt-6">
          <LiveStatus initial={JSON.parse(JSON.stringify(rows))} title="Live employee status" />
        </div>
      </div>
    </>
  );
}

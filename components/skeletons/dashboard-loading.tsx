import { StatsSkeleton, TableSkeleton, Skeleton } from "@/components/ui/skeleton";

export function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2"><Skeleton className="h-7 w-64" /><Skeleton className="h-4 w-40" /></div>
      <StatsSkeleton />
      <div className="rounded-2xl bg-card shadow-card ring-1 ring-border/60"><TableSkeleton rows={6} cols={5} /></div>
    </div>
  );
}

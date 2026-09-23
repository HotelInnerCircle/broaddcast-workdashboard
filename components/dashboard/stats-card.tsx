import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/** KPI colour tiles ("Bento"): each tone is a full pastel tile with a matching ink colour, a serif number and a soft blob. */
const tones = {
  default: "bg-tile-default text-tile-default-fg",
  success: "bg-tile-success text-tile-success-fg",
  warning: "bg-tile-warning text-tile-warning-fg",
  danger: "bg-tile-danger text-tile-danger-fg",
  info: "bg-tile-info text-tile-info-fg",
  muted: "bg-tile-muted text-tile-muted-fg",
};

export function StatsCard({ label, value, hint, icon: Icon, tone = "default", className }: { label: string; value: React.ReactNode; hint?: string; icon?: LucideIcon; tone?: keyof typeof tones; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-2xl p-5", tones[tone], className)}>
      <span aria-hidden className="pointer-events-none absolute -right-6 -bottom-8 size-28 rounded-full bg-white/35 dark:bg-white/6" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold opacity-80 max-md:leading-tight md:truncate">{label}</p>
          <p className="mt-2 font-display text-[38px] leading-none tabular-nums">{value}</p>
          {hint && <p className="mt-2.5 text-xs font-medium opacity-75">{hint}</p>}
        </div>
        {Icon && <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/50 dark:bg-white/8"><Icon className="size-5" strokeWidth={1.9} /></div>}
      </div>
    </div>
  );
}

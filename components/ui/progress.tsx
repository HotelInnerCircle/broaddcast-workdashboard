import { cn } from "@/lib/utils/cn";

export function ProgressBar({ value, className, tone }: { value: number; className?: string; tone?: "auto" | "primary" | "success" }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const color = tone === "success" || (tone !== "primary" && pct >= 100) ? "bg-success" : "bg-primary";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-border/70", className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-[width]", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

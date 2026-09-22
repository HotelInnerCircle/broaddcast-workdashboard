import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Icon className="size-6" />
        </div>
      )}
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-danger">Something went wrong</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message ?? "We could not load this data."}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 rounded-full bg-card px-4 py-1.5 text-sm shadow-card ring-1 ring-border/70 hover:bg-muted">Try again</button>
      )}
    </div>
  );
}

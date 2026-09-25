import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown while a dashboard page is being built on the server (A92).
 *
 * Next streams this immediately on an in-app navigation, so moving between pages shows the shape
 * of what is coming rather than freezing on the previous screen. It does nothing for the very
 * first load after signing in - that is a fresh document, and the browser holds the old page until
 * the HTML arrives.
 */
export default function Loading() {
  return (
    <div className="animate-in space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}

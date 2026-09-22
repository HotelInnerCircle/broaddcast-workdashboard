import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shown on the admin dashboard until the (skippable) setup wizard has been completed (spec 6.1). */
export function SetupBanner() {
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary-soft/60 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="size-5" /></div>
        <div>
          <p className="font-medium">Finish setting up your workspace</p>
          <p className="text-sm text-muted-foreground">Confirm your timezone, working hours and logo. Takes about a minute and can be skipped.</p>
        </div>
      </div>
      <Button asChild><Link href="/admin/setup">Open setup</Link></Button>
    </div>
  );
}

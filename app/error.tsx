"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * What a person sees when a page throws.
 *
 * The default is a bare "Application error: a server-side exception has
 * occurred" with a digest and no way forward, which reads as the whole app being
 * broken rather than one page. This keeps them inside the app, offers to try
 * again - most of these are transient - and shows the digest, because that
 * number is what makes the failure findable in the logs.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // The server logs this too; this covers the client-side half.
    console.error("page error", error?.digest ?? "", error);
  }, [error]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="w-full max-w-md text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-danger-soft text-danger">
          <AlertTriangle className="size-6" />
        </span>
        <h1 className="mt-4 font-display text-[28px] leading-tight">This page could not be shown</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong loading it. The rest of the app is still working, and trying again
          often clears it.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={reset}><RotateCw />Try again</Button>
          <Button variant="outline" asChild><Link href="/">Go to the dashboard</Link></Button>
        </div>
        {error?.digest && (
          <p className="mt-6 text-[11.5px] text-muted-foreground">
            If it keeps happening, quote this reference: <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </div>
  );
}

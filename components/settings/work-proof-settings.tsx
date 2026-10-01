"use client";

import { useState } from "react";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, ClientApiError } from "@/lib/api/client";

/**
 * Whether a picture has to come with the work (A135).
 *
 * The setting existed from the day the requirement did, and there was no way to
 * change it - so a company that wanted the description without the photograph
 * had to ask somebody to write a PATCH. Asking people for a photograph twice a
 * day is a real imposition, and whether it is worth it is the company's
 * decision, not a constant in a file.
 *
 * On by default, because that is how it arrived and a company that predates
 * this switch should keep the behaviour it already had.
 */
export function WorkProofSettings({ timer, dailyReport }: { timer: boolean; dailyReport: boolean }) {
  const [state, setState] = useState({ timer, dailyReport });
  const [busy, setBusy] = useState(false);

  const toggle = async (key: "timer" | "dailyReport", value: boolean) => {
    const next = { ...state, [key]: value };
    setState(next);
    setBusy(true);
    try {
      await api("/api/admin/company", { method: "PATCH", json: { workProof: next } });
      toast.success(value ? "A picture is now required" : "A picture is now optional");
    } catch (e) {
      setState(state); // put the switch back if it did not take
      toast.error(e instanceof ClientApiError ? e.message : "Could not save");
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Camera className="size-4" />A picture of the work</CardTitle>
        <CardDescription>
          Whether people have to attach a photograph when they stop a timer or file a daily report.
          The description is always required; this is only about the picture.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {[
          { key: "timer" as const, label: "When stopping a timer", why: "A screenshot of what they were working on." },
          { key: "dailyReport" as const, label: "When filing a daily report", why: "One picture covering the day's work." },
        ].map((row) => (
          <label key={row.key} className="flex items-start gap-3">
            <input
              type="checkbox" className="mt-1 size-4" disabled={busy}
              checked={state[row.key]}
              onChange={(e) => void toggle(row.key, e.target.checked)}
            />
            <span className="text-[13.5px]">
              <span className="font-semibold">{row.label}</span>
              <span className="block text-muted-foreground">{row.why}</span>
            </span>
          </label>
        ))}
        {/*
          Said plainly, because turning it off does not delete anything and
          somebody might reasonably fear that it does.
        */}
        <p className="rounded-xl bg-muted/50 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
          Turning one off makes the picture optional from then on. Pictures already taken are kept,
          and people can still attach one if they want to.
        </p>
      </CardContent>
    </Card>
  );
}

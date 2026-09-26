"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Lock, Plus, X } from "lucide-react";
import { api, ClientApiError } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

type Step = "TEAM_LEAD" | "MANAGER" | "HR";
const LABEL: Record<Step, string> = { TEAM_LEAD: "Team lead", MANAGER: "Manager", HR: "HR" };
const WHO: Record<Step, string> = {
  TEAM_LEAD: "The lead of the person's team. Skipped if they have no team, or if they are the lead.",
  MANAGER: "Their manager, or their team's manager. Skipped if they have neither.",
  HR: "Anyone in HR, and the company admin.",
};

/**
 * The order leave and off-site swipes are approved in (A104).
 *
 * HR is fixed at the end and cannot be removed, and that is worth being plain
 * about on screen rather than just refusing to move it: HR is the step *anyone*
 * in HR can settle, so it is what guarantees a request can always be decided.
 * Put a named individual last instead and a request sits there when that person
 * is on leave, or has left the company.
 */
export function ApprovalChainEditor({ initial }: { initial: string[] }) {
  const clean = (a: string[]): Step[] => {
    const known = a.filter((s): s is Step => s === "TEAM_LEAD" || s === "MANAGER" || s === "HR");
    return [...known.filter((s) => s !== "HR"), "HR"];
  };
  const [chain, setChain] = useState<Step[]>(() => clean(initial.length ? initial : ["TEAM_LEAD", "MANAGER", "HR"]));
  const [saving, setSaving] = useState(false);

  /** Everything the admin may reorder - which is everything except HR. */
  const before: Step[] = chain.filter((s): s is Exclude<Step, "HR"> => s !== "HR");
  const missing: Step[] = (["TEAM_LEAD", "MANAGER"] as const).filter((s) => !chain.includes(s));

  const move = (i: number, by: number) => {
    const next = [...before];
    const j = i + by;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setChain([...next, "HR"]);
  };
  const remove = (s: Step) => setChain([...before.filter((x) => x !== s), "HR"]);
  const add = (s: Step) => setChain([...before, s, "HR"]);

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/admin/company", { method: "PATCH", json: { approvalChain: chain } });
      toast.success("Approval order saved");
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save"); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who approves, and in what order</CardTitle>
        <CardDescription>
          Leave requests and swipes from away from a work site go through these steps in turn. A step
          is skipped when there is nobody to fill it - somebody with no team lead starts at their manager.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="space-y-2">
          {chain.map((step, i) => {
            const fixed = step === "HR";
            const idx = before.indexOf(step);
            return (
              <li key={step} className={cn("flex flex-wrap items-center gap-3 rounded-2xl p-3 ring-1",
                fixed ? "bg-muted/50 ring-border" : "bg-card ring-border/60 shadow-card")}>
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-[12px] font-bold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-medium">
                    {LABEL[step]}
                    {fixed && <Lock className="size-3.5 text-muted-foreground" />}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">{WHO[step]}</p>
                </div>
                {!fixed && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="outline" size="icon" aria-label={`Move ${LABEL[step]} earlier`}
                      disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUp /></Button>
                    <Button variant="outline" size="icon" aria-label={`Move ${LABEL[step]} later`}
                      disabled={idx === before.length - 1} onClick={() => move(idx, 1)}><ArrowDown /></Button>
                    <Button variant="outline" size="icon" aria-label={`Remove the ${LABEL[step]} step`}
                      onClick={() => remove(step)}><X /></Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {missing.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-muted-foreground">Add a step:</span>
            {missing.map((s) => (
              <Button key={s} variant="outline" size="sm" onClick={() => add(s)}><Plus />{LABEL[s]}</Button>
            ))}
          </div>
        )}

        <p className="rounded-xl bg-muted/50 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">HR stays last on purpose.</strong> It is the only step that
          anyone in HR - and the company admin - can settle, so it is what makes sure a request can always
          be decided. End with a single named person instead and a request waits there while they are on
          leave, or after they have left.
        </p>

        <div className="flex justify-end">
          <Button loading={saving} onClick={() => void save()}>Save order</Button>
        </div>
      </CardContent>
    </Card>
  );
}

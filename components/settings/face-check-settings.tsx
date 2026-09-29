"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ScanFace, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Lightbox, type LightboxImage } from "@/components/ui/lightbox";
import { api, ClientApiError } from "@/lib/api/client";

interface Row {
  userId: string; userName: string; employeeCode: string | null;
  enrolled: boolean; enrolledAt: string | null; samples: number;
  approval: string; approvedAt: string | null; reviewNote: string | null;
  photoUrl: string | null;
}
interface Register {
  rows: Row[]; enrolled: number; approved: number; pending: number; total: number;
  settings: { enabled: boolean; threshold: number; maxRetries: number; enrolAtSite: boolean };
}

/**
 * The face check: who may be recognised, and who has agreed that they may (A120).
 *
 * Both halves live here because they are one decision. Switching the check on
 * before faces are approved means everybody swipes unverified; approving faces
 * while it is off means nothing happens yet. Seeing the counts next to the
 * switch is what makes the order obvious.
 */
export function FaceCheckSettings() {
  const [data, setData] = useState<Register | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<LightboxImage | null>(null);

  const load = useCallback(async () => {
    try { setData(await api<Register>("/api/face/enrolment", { fresh: true })); }
    catch { setData(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patch = async (change: Record<string, unknown>) => {
    setBusy("settings");
    try {
      await api("/api/admin/company", { method: "PATCH", json: { faceCheck: change } });
      await load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save that"); }
    finally { setBusy(null); }
  };

  const decide = async (row: Row, decision: "APPROVED" | "REJECTED") => {
    // A rejection has to say why: it clears their face and sends them back to
    // enrol again, and "no" with no reason is a support ticket.
    const note = decision === "REJECTED"
      ? window.prompt(`Why is ${row.userName}'s enrolment being turned down?\nThey will be told, and asked to enrol again.`)
      : null;
    if (decision === "REJECTED" && note === null) return;
    setBusy(row.userId);
    try {
      await api(`/api/face/enrolment/${row.userId}`, { method: "PATCH", json: { decision, note } });
      toast.success(decision === "APPROVED" ? `${row.userName}'s face approved` : `${row.userName} has been asked to enrol again`);
      await load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not record that"); }
    finally { setBusy(null); }
  };

  const s = data?.settings;
  const pending = (data?.rows ?? []).filter((r) => r.approval === "pending");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ScanFace className="size-4" />Face check</CardTitle>
          <CardDescription>
            Checks the face in a swipe photo against the one each person enrolled. Enrol everybody
            first, approve their faces, then switch it on - turning it on before that leaves people
            swiping unverified.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!s ? <TableSkeleton rows={3} /> : (
            <>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 size-4" checked={s.enabled}
                  onChange={(e) => void patch({ enabled: e.target.checked })} disabled={busy === "settings"} />
                <span className="text-[13.5px]">
                  <span className="font-semibold">Check faces on swipes</span>
                  <span className="block text-muted-foreground">
                    {data.approved} of {data.total} {data.total === 1 ? "person has" : "people have"} an approved face.
                    {data.pending > 0 && ` ${data.pending} waiting for a decision.`}
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 size-4" checked={s.enrolAtSite}
                  onChange={(e) => void patch({ enrolAtSite: e.target.checked })} disabled={busy === "settings"} />
                <span className="text-[13.5px]">
                  <span className="font-semibold">Only allow enrolling at a work site</span>
                  <span className="block text-muted-foreground">
                    The easiest way to enrol somebody else&apos;s face is from home. Does nothing until
                    work sites exist.
                  </span>
                </span>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-[13px] font-semibold">How alike is the same person</p>
                  <p className="mb-1.5 text-[12px] text-muted-foreground">
                    Lower rejects somebody who grew a beard; higher accepts their brother. 0.6 is where to start.
                  </p>
                  <Input type="number" step="0.05" min="0.1" max="1.5" defaultValue={s.threshold}
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== s.threshold) void patch({ threshold: v }); }} />
                </div>
                <div>
                  <p className="text-[13px] font-semibold">Tries before it goes through anyway</p>
                  <p className="mb-1.5 text-[12px] text-muted-foreground">
                    After this many, the swipe is recorded and flagged rather than refused - bad light must not stop somebody clocking in.
                  </p>
                  <Input type="number" min="1" max="10" defaultValue={s.maxRetries}
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== s.maxRetries) void patch({ maxRetries: v }); }} />
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4" />Faces waiting for approval</CardTitle>
          <CardDescription>
            Look at the photo and say whether it is that person. Until somebody does, the check has
            nothing it can trust: a face nobody agreed to is whichever face was held up to the camera first.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {!data ? <TableSkeleton rows={3} />
            : pending.length === 0 ? (
              <EmptyState icon={ShieldCheck} title="Nothing waiting"
                description={data.enrolled === 0 ? "Nobody has enrolled a face yet." : "Every enrolled face has been decided on."} />
            ) : (
              <Table cards={false}>
                <THead><TR><TH>Photo</TH><TH>Employee</TH><TH>Enrolled</TH><TH className="text-right">Decision</TH></TR></THead>
                <TBody>
                  {pending.map((r) => (
                    <TR key={r.userId}>
                      <TD>
                        {r.photoUrl ? (
                          <button type="button" onClick={() => setViewing({ name: r.userName, url: r.photoUrl as string, downloadUrl: r.photoUrl as string })}
                            className="block rounded-md ring-1 ring-border hover:opacity-80" title="See it full size">
                            {/* eslint-disable-next-line @next/next/no-img-element -- a signed link that expires */}
                            <img src={r.photoUrl} alt={`${r.userName} at enrolment`} className="h-16 w-16 rounded-md object-cover" />
                          </button>
                        ) : (
                          // Enrolled before pictures were kept, so there is nothing
                          // to recognise. Say so rather than showing a blank box.
                          <span className="text-xs text-muted-foreground">No photo</span>
                        )}
                      </TD>
                      <TD>
                        <span className="font-medium">{r.userName}</span>
                        {r.employeeCode && <span className="block text-xs text-muted-foreground">{r.employeeCode}</span>}
                      </TD>
                      <TD className="text-muted-foreground">
                        {r.enrolledAt ? new Date(r.enrolledAt).toLocaleDateString() : "-"}
                        <Badge className="ml-2" variant="outline">{r.samples} captures</Badge>
                      </TD>
                      <TD className="text-right">
                        <div className="inline-flex gap-2">
                          <Button size="sm" variant="outline" loading={busy === r.userId} onClick={() => void decide(r, "REJECTED")}>
                            <X />Not them
                          </Button>
                          <Button size="sm" loading={busy === r.userId} onClick={() => void decide(r, "APPROVED")}>
                            <Check />That is them
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
        </CardContent>
      </Card>

      {viewing && <Lightbox images={[viewing]} index={0} onClose={() => setViewing(null)} />}
    </div>
  );
}

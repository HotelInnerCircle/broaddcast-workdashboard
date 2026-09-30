"use client";

import { useCallback, useEffect, useState } from "react";
import { DoorOpen, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, ClientApiError } from "@/lib/api/client";

interface Device { id: string; name: string; siteName: string; active: boolean; lastSeenAt: string | null }
interface Site { id: string; name: string }

/**
 * The tablets on doors, and how to add one (A126).
 *
 * The code a new device is given is shown once, here, and never again - it is
 * stored hashed the way a password is. So this screen has to make that obvious
 * at the moment it appears, rather than leaving somebody to discover it by
 * closing the dialog.
 */
export function DoorDevices() {
  const [rows, setRows] = useState<Device[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [name, setName] = useState("");
  const [siteId, setSiteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ name: string; token: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [devices, workSites] = await Promise.all([
        api<Device[]>("/api/admin/door-devices", { fresh: true }),
        api<Site[]>("/api/work-sites", { fresh: true }).catch(() => [] as Site[]),
      ]);
      setRows(devices);
      setSites(workSites);
      if (!siteId && workSites[0]) setSiteId(workSites[0].id);
    } catch { setRows([]); }
  }, [siteId]);
  useEffect(() => { void load(); }, [load]);

  const register = async () => {
    setBusy(true);
    try {
      const made = await api<{ id: string; name: string; token: string }>("/api/admin/door-devices", {
        method: "POST", json: { name: name.trim(), siteId },
      });
      setFresh({ name: made.name, token: made.token });
      setName("");
      await load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not register it"); }
    finally { setBusy(false); }
  };

  const revoke = async (d: Device) => {
    // A device is revoked because it has left the building, so say that out loud.
    if (!confirm(`Stop trusting "${d.name}"?\nIt will stop recording attendance immediately.`)) return;
    try {
      await api(`/api/admin/door-devices/${d.id}`, { method: "DELETE" });
      toast.success(`${d.name} revoked`);
      await load();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not revoke it"); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><DoorOpen className="size-4" />Devices at doors</CardTitle>
          <CardDescription>
            A tablet on a wall that recognises faces and records attendance. Open{" "}
            <span className="font-mono text-[12px]">/kiosk</span> on the tablet and paste the code it is given below.
            People have to have enrolled and been approved first, or the door has nobody to recognise.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sites.length === 0 ? (
            <p className="rounded-xl bg-warning-soft px-4 py-3 text-[13px] text-tile-warning-fg">
              Add a work site first, under Shifts &amp; holidays. A device is fixed to one, and that is how it
              knows where it is without asking for a location.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-48 flex-1">
                <label htmlFor="door-name" className="text-[13px] font-semibold">What to call it</label>
                <Input id="door-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Front gate tablet" />
              </div>
              <div className="min-w-44">
                <label htmlFor="door-site" className="text-[13px] font-semibold">Where it is</label>
                <NativeSelect id="door-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </NativeSelect>
              </div>
              <Button loading={busy} disabled={!name.trim() || !siteId} onClick={() => void register()}>Register</Button>
            </div>
          )}

          {fresh && (
            <div className="rounded-xl bg-success-soft px-4 py-3">
              <p className="text-[13px] font-semibold text-tile-success-fg">{fresh.name} is registered</p>
              {/*
                Shown once. It is stored hashed, so there is no screen anywhere
                that can show it again - and somebody who closes this without
                copying it has to register the device afresh.
              */}
              <p className="mt-1 text-[12.5px] text-tile-success-fg">
                Copy this code into the tablet now. It is not shown again, and it is the only thing
                that lets that screen record attendance - treat it like a key.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-background px-3 py-2 font-mono text-[12px]">{fresh.token}</code>
                <Button size="sm" variant="outline" onClick={() => {
                  void navigator.clipboard.writeText(fresh.token).then(
                    () => toast.success("Copied"),
                    () => toast.error("Could not copy - select it by hand"),
                  );
                }}><Copy />Copy</Button>
                <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>Done</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {!rows ? <TableSkeleton rows={2} />
            : rows.length === 0 ? (
              <EmptyState icon={DoorOpen} title="No devices yet" description="Register one above, then open /kiosk on the tablet." />
            ) : (
              <Table cards={false}>
                <THead><TR><TH>Device</TH><TH>Where</TH><TH>Last seen</TH><TH className="text-right">Trust</TH></TR></THead>
                <TBody>
                  {rows.map((d) => (
                    <TR key={d.id}>
                      <TD className="font-medium">{d.name}</TD>
                      <TD className="text-muted-foreground">{d.siteName}</TD>
                      <TD className="text-muted-foreground">
                        {d.lastSeenAt ? <RelativeTime value={d.lastSeenAt} /> : "Never used"}
                      </TD>
                      <TD className="text-right">
                        <Button size="sm" variant="outline" onClick={() => void revoke(d)}><Trash2 />Revoke</Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

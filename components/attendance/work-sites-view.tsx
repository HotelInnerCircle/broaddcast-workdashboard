"use client";
import { useEffect, useState } from "react";
import { Crosshair, MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, ClientApiError } from "@/lib/api/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import type { Site } from "./use-swipe";

const BLANK = { name: "", lat: "", lng: "", radiusMeters: "150" };

/**
 * Where attendance may be swiped from (A83). HR draws a circle: a point and a radius.
 *
 * "Use my location" exists because nobody knows their office's coordinates offhand, and asking
 * people to find them on a map is how you end up with a site 300 m off.
 */
export function WorkSitesView() {
  const [sites, setSites] = useState<Site[]>([]);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const load = () => void api<Site[]>("/api/work-sites", { fresh: true }).then(setSites).catch(() => setSites([]));
  useEffect(load, []);

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) { toast.error("This device cannot report its location"); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setForm((f) => ({ ...f, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }));
        setLocating(false);
        toast.success(`Picked up your position, accurate to about ${Math.round(p.coords.accuracy)} m`);
      },
      () => { setLocating(false); toast.error("Could not read your location"); },
      { enableHighAccuracy: true, timeout: 20000 },
    );
  };

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/work-sites", {
        method: "POST",
        json: { name: form.name.trim(), lat: Number(form.lat), lng: Number(form.lng), radiusMeters: Number(form.radiusMeters) },
      });
      setForm(BLANK);
      load();
      toast.success("Work site added");
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Could not add the site");
    } finally { setSaving(false); }
  };

  const remove = async (s: Site) => {
    try {
      await api(`/api/work-sites/${s.id}`, { method: "DELETE" });
      load();
      toast.success(`${s.name} removed`);
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Could not remove the site");
    }
  };

  const valid = form.name.trim().length >= 2 && form.lat !== "" && form.lng !== "" && Number(form.radiusMeters) >= 25;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardContent className="p-0">
          {sites.length === 0 ? (
            <EmptyState icon={MapPin} title="No work sites yet" description="Add the places people are allowed to swipe from. A swipe taken anywhere else goes for approval." className="py-10" />
          ) : (
            <ul className="divide-y divide-border">
              {sites.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success-soft text-tile-success-fg"><MapPin className="size-[18px]" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.lat.toFixed(5)}, {s.lng.toFixed(5)} &middot; anyone within {s.radiusMeters} m counts as on site
                    </p>
                  </div>
                  <a
                    href={`https://www.google.com/maps?q=${s.lat},${s.lng}`} target="_blank" rel="noopener noreferrer"
                    className="shrink-0 text-xs font-semibold text-primary hover:underline"
                  >Map</a>
                  <button type="button" onClick={() => void remove(s)} aria-label={`Remove ${s.name}`} className="shrink-0 rounded-full p-2 text-muted-foreground hover:bg-danger-soft hover:text-danger">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <p className="text-sm font-semibold">Add a site</p>
          <div><Label htmlFor="ws-name">Name</Label><Input id="ws-name" value={form.name} placeholder="Head Office" onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="ws-lat">Latitude</Label><Input id="ws-lat" value={form.lat} inputMode="decimal" placeholder="12.971600" onChange={(e) => setForm({ ...form, lat: e.target.value })} /></div>
            <div><Label htmlFor="ws-lng">Longitude</Label><Input id="ws-lng" value={form.lng} inputMode="decimal" placeholder="77.594600" onChange={(e) => setForm({ ...form, lng: e.target.value })} /></div>
          </div>
          <Button type="button" variant="outline" className="w-full" onClick={useMyLocation} disabled={locating}>
            <Crosshair className="size-4" />{locating ? "Reading..." : "Use my location"}
          </Button>
          <div>
            <Label htmlFor="ws-radius">Radius in metres</Label>
            <Input id="ws-radius" value={form.radiusMeters} inputMode="numeric" onChange={(e) => setForm({ ...form, radiusMeters: e.target.value })} />
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              Phone GPS drifts by 5-20 m outdoors and much more indoors. Below about 100 m you will
              start flagging people who are genuinely at their desk.
            </p>
          </div>
          <Button type="button" className="w-full" onClick={() => void save()} disabled={!valid || saving}>
            <Plus className="size-4" />{saving ? "Adding..." : "Add site"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

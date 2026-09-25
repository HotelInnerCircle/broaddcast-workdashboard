"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Camera, ChevronRight, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { api, ClientApiError } from "@/lib/api/client";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils/cn";

export interface Profile {
  id: string; name: string; email: string; role: string; roleLabel: string;
  avatarUrl: string | null; phone: string | null;
  gender: string | null; maritalStatus: string | null; dateOfBirth: string | null; joiningDate: string | null;
  employeeCode: string | null;
  companyName: string | null; designation: string | null; department: string | null; branch: string | null;
  teamName: string | null; managerName: string | null;
  address: string | null;
  emergencyContact: { name: string | null; relation: string | null; phone: string | null };
  updateRequest: string | null; updateRequestAt: string | null;
}
export interface ReportingItem { userId: string; userName: string; kind: string; count: number; href: string }

const GENDERS = [["", "Not set"], ["male", "Male"], ["female", "Female"], ["other", "Other"], ["prefer_not_to_say", "Prefer not to say"]];
const MARITAL = [["", "Not set"], ["single", "Single"], ["married", "Married"], ["other", "Other"], ["prefer_not_to_say", "Prefer not to say"]];
const pick = (opts: string[][], v: string | null) => opts.find(([k]) => k === (v ?? ""))?.[1] ?? "Not set";
const pretty = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : null);

export function Row({ k, v }: { k: string; v: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3 last:border-0">
      <span className="shrink-0 text-[13px] text-muted-foreground">{k}</span>
      <span className="min-w-0 text-right text-[13.5px] font-medium">{v || "Not set"}</span>
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h2 className="text-[11px] font-bold tracking-wide text-muted-foreground">{title}</h2>
        {action}
      </div>
      <div className="overflow-hidden rounded-2xl bg-card shadow-card ring-1 ring-border/50">{children}</div>
    </section>
  );
}

const INPUT = "w-full rounded-xl bg-muted px-3 py-2 text-[13.5px] outline-none ring-1 ring-transparent focus:ring-primary";

/** A93: who someone is, what their job is, and what is waiting on them. */
export function ProfileDetails({ profile, reporting, onChanged }: { profile: Profile; reporting: ReportingItem[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setForm(profile), [profile]);

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/me", { method: "PATCH", json: {
        name: form.name, phone: form.phone, gender: form.gender || null, maritalStatus: form.maritalStatus || null,
        dateOfBirth: form.dateOfBirth || null, address: form.address || null,
        emergencyContact: form.emergencyContact, updateRequest: form.updateRequest || null,
      } });
      setEditing(false); onChanged(); toast.success("Profile saved");
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save"); }
    finally { setSaving(false); }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("photo", file);
      await api("/api/me/avatar", { method: "POST", body: fd });
      onChanged(); toast.success("Photo updated");
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not upload the photo"); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const ec = form.emergencyContact;
  const set = (patch: Partial<Profile>) => setForm({ ...form, ...patch });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 rounded-2xl bg-card p-4 shadow-card ring-1 ring-border/50">
        <div className="relative shrink-0">
          <Avatar name={profile.name} src={profile.avatarUrl} className="size-16" />
          <input ref={fileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
            aria-label="Change profile photo"
            className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-card">
            <Camera className="size-3.5" />
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold">{profile.name}</p>
          <p className="truncate text-[12.5px] text-muted-foreground">{profile.email}</p>
          <p className="mt-1 inline-block rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
            {profile.roleLabel}{profile.designation ? ` - ${profile.designation}` : ""}
          </p>
        </div>
      </div>

      <Section title="PERSONAL" action={editing ? (
        <div className="flex gap-3">
          <button type="button" onClick={() => { setEditing(false); setForm(profile); }} className="flex items-center gap-1 text-[12px] font-semibold text-muted-foreground"><X className="size-3.5" />Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="flex items-center gap-1 text-[12px] font-semibold text-primary"><Save className="size-3.5" />{saving ? "Saving..." : "Save"}</button>
        </div>
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 text-[12px] font-semibold text-primary"><Pencil className="size-3.5" />Edit</button>
      )}>
        {editing ? (
          <div className="space-y-3 p-4">
            <label className="block text-[12px] font-semibold">Name<input className={cn(INPUT, "mt-1")} value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
            <label className="block text-[12px] font-semibold">Phone<input className={cn(INPUT, "mt-1")} value={form.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} /></label>
            <label className="block text-[12px] font-semibold">Gender
              <select className={cn(INPUT, "mt-1")} value={form.gender ?? ""} onChange={(e) => set({ gender: e.target.value })}>
                {GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block text-[12px] font-semibold">Marital status
              <select className={cn(INPUT, "mt-1")} value={form.maritalStatus ?? ""} onChange={(e) => set({ maritalStatus: e.target.value })}>
                {MARITAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block text-[12px] font-semibold">Date of birth<input type="date" className={cn(INPUT, "mt-1")} value={form.dateOfBirth ?? ""} onChange={(e) => set({ dateOfBirth: e.target.value })} /></label>
            <label className="block text-[12px] font-semibold">Address<textarea rows={3} className={cn(INPUT, "mt-1 resize-none")} value={form.address ?? ""} onChange={(e) => set({ address: e.target.value })} /></label>
            <p className="pt-1 text-[11px] font-bold tracking-wide text-muted-foreground">EMERGENCY CONTACT</p>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="Emergency contact name" placeholder="Name" className={INPUT} value={ec.name ?? ""} onChange={(e) => set({ emergencyContact: { ...ec, name: e.target.value } })} />
              <input aria-label="Relation" placeholder="Relation" className={INPUT} value={ec.relation ?? ""} onChange={(e) => set({ emergencyContact: { ...ec, relation: e.target.value } })} />
            </div>
            <input aria-label="Emergency contact phone" placeholder="Phone" className={INPUT} value={ec.phone ?? ""} onChange={(e) => set({ emergencyContact: { ...ec, phone: e.target.value } })} />
            <label className="block text-[12px] font-semibold">Ask HR to change something
              <textarea rows={2} placeholder="e.g. my designation is out of date" className={cn(INPUT, "mt-1 resize-none")} value={form.updateRequest ?? ""} onChange={(e) => set({ updateRequest: e.target.value })} />
            </label>
          </div>
        ) : (
          <>
            <Row k="Phone" v={profile.phone} />
            <Row k="Gender" v={pick(GENDERS, profile.gender)} />
            <Row k="Marital status" v={pick(MARITAL, profile.maritalStatus)} />
            <Row k="Date of birth" v={pretty(profile.dateOfBirth)} />
            <Row k="Address" v={profile.address} />
            <Row k="Emergency contact" v={[profile.emergencyContact.name, profile.emergencyContact.relation, profile.emergencyContact.phone].filter(Boolean).join(" - ") || null} />
          </>
        )}
      </Section>

      <Section title="EMPLOYMENT">
        <Row k="Employee code" v={profile.employeeCode} />
        <Row k="Company" v={profile.companyName} />
        <Row k="Designation" v={profile.designation} />
        <Row k="Department" v={profile.department} />
        <Row k="Branch" v={profile.branch} />
        <Row k="Team" v={profile.teamName} />
        <Row k="Reports to" v={profile.managerName} />
        <Row k="Joined" v={pretty(profile.joiningDate)} />
        <p className="px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
          HR keeps these. If something here is wrong, say so under Edit above and they will see it.
        </p>
      </Section>

      {profile.updateRequest && (
        <div className="rounded-2xl bg-warning-soft px-4 py-3 text-[12.5px] text-tile-warning-fg">
          <p className="font-semibold">Update requested</p>
          <p className="mt-0.5 leading-relaxed">{profile.updateRequest}</p>
        </div>
      )}

      {reporting.length > 0 && (
        <Section title="REPORTING LIST">
          {reporting.map((r, i) => (
            <Link key={`${r.userId}-${r.kind}-${i}`} href={r.href} className="flex items-center gap-3 border-b border-border px-4 py-3.5 last:border-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold">{r.userName}</p>
                <p className="truncate text-[12px] text-muted-foreground">{r.kind}-{r.count}</p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                r.kind === "Swipes" ? "bg-success-soft text-tile-success-fg" : "bg-warning-soft text-tile-warning-fg")}>{r.kind}</span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </Section>
      )}
    </div>
  );
}

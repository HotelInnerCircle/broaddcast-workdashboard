"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { z } from "zod";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field, Label } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/api/client";
import { hhmm } from "@/lib/validation/common";
import { WEEKDAYS } from "@/types";

export interface CompanySettings {
  id: string; name: string; logoUrl: string | null; timezone: string; currency: string;
  workingHours: { start: string; end: string }; workingDays: string[]; lateThresholdMinutes: number; defaultTaskStatus: string; setupCompleted: boolean;
  /** The order leave and off-site swipes are approved in (A104). */
  approvalChain: string[];
}

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  timezone: z.string().min(1),
  currency: z.string().length(3),
  start: hhmm,
  end: hhmm,
  workingDays: z.array(z.enum(WEEKDAYS)).min(1, "Pick at least one working day"),
  lateThresholdMinutes: z.coerce.number<number>().int().min(0).max(240),
  defaultTaskStatus: z.string().min(1),
});
type Input = z.infer<typeof schema>;

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney", "Europe/London", "Europe/Berlin", "Europe/Paris", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "Africa/Johannesburg", "UTC"];
const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"];
const DAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export function CompanySettingsForm({ company, mode = "settings" }: { company: CompanySettings; mode?: "settings" | "setup" }) {
  const router = useRouter();
  const [logo, setLogo] = useState(company.logoUrl);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Input>({
    resolver: zodResolver(schema),
    defaultValues: { name: company.name, timezone: company.timezone, currency: company.currency, start: company.workingHours.start, end: company.workingHours.end, workingDays: company.workingDays as Input["workingDays"], lateThresholdMinutes: company.lateThresholdMinutes, defaultTaskStatus: company.defaultTaskStatus },
  });

  const onSubmit = async (v: Input) => {
    try {
      await api("/api/admin/company", { method: "PATCH", json: { name: v.name, timezone: v.timezone, currency: v.currency, workingHours: { start: v.start, end: v.end }, workingDays: v.workingDays, lateThresholdMinutes: v.lateThresholdMinutes, defaultTaskStatus: v.defaultTaskStatus, ...(mode === "setup" ? { setupCompleted: true } : {}) } });
      toast.success(mode === "setup" ? "Workspace is ready" : "Settings saved");
      if (mode === "setup") router.push("/admin/dashboard");
      router.refresh();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save settings"); }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api<{ logoUrl: string }>("/api/admin/company/logo", { method: "POST", body: fd });
      setLogo(res.logoUrl);
      toast.success("Logo updated");
      router.refresh();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Upload failed"); } finally { setUploading(false); }
  };

  const skip = async () => {
    try { await api("/api/admin/company", { method: "PATCH", json: { setupCompleted: true } }); router.push("/admin/dashboard"); router.refresh(); } catch { toast.error("Could not skip setup"); }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>{mode === "setup" ? "Set up your workspace" : "Company"}</CardTitle>
          <CardDescription>{mode === "setup" ? "Sensible defaults are already applied - you can skip this and change everything later." : "Name, logo, timezone, currency, working hours and attendance rules."}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <div className="flex size-16 items-center justify-center overflow-hidden rounded-xl border border-border bg-muted">
              {logo ? <img src={logo} alt="Company logo" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">No logo</span>}
            </div>
            <div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
              <Button type="button" variant="outline" loading={uploading} onClick={() => fileRef.current?.click()}><Upload />Upload logo</Button>
              <p className="mt-1 text-xs text-muted-foreground">PNG, JPG or WEBP, up to 10 MB.</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Company name" htmlFor="c-name" error={errors.name?.message}><Input id="c-name" {...register("name")} /></Field>
            <Field label="Timezone" htmlFor="c-tz" error={errors.timezone?.message}>
              <NativeSelect id="c-tz" {...register("timezone")}>{[...new Set([company.timezone, ...TIMEZONES])].map((t) => <option key={t} value={t}>{t}</option>)}</NativeSelect>
            </Field>
            <Field label="Currency" htmlFor="c-cur" error={errors.currency?.message}>
              <NativeSelect id="c-cur" {...register("currency")}>{[...new Set([company.currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}</NativeSelect>
            </Field>
            <Field label="Default task status" htmlFor="c-status"><Input id="c-status" {...register("defaultTaskStatus")} /></Field>
            <Field label="Work starts" htmlFor="c-start" error={errors.start?.message}><Input id="c-start" type="time" {...register("start")} /></Field>
            <Field label="Work ends" htmlFor="c-end" error={errors.end?.message}><Input id="c-end" type="time" {...register("end")} /></Field>
            <Field label="Late threshold (minutes)" htmlFor="c-late" error={errors.lateThresholdMinutes?.message} hint="Clock-in later than this after work start is marked Late."><Input id="c-late" type="number" min={0} max={240} {...register("lateThresholdMinutes")} /></Field>
            <div className="space-y-1.5">
              <Label>Working days</Label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d) => (
                  <label key={d} className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary">
                    <input type="checkbox" value={d} className="sr-only" {...register("workingDays")} />{DAY_LABEL[d]}
                  </label>
                ))}
              </div>
              {errors.workingDays && <p className="text-xs text-danger">{errors.workingDays.message}</p>}
            </div>
          </div>
        </CardContent>
        <CardFooter className="justify-end">
          {mode === "setup" && <Button type="button" variant="ghost" onClick={skip}>Skip for now</Button>}
          <Button type="submit" loading={isSubmitting}>{mode === "setup" ? "Finish setup" : "Save changes"}</Button>
        </CardFooter>
      </Card>
    </form>
  );
}

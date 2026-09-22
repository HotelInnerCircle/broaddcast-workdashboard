"use client";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Field } from "@/components/ui/label";
import { Avatar } from "@/components/ui/avatar";
import { api, ClientApiError } from "@/lib/api/client";
import { useAuth } from "@/hooks/useAuth";
import { changePasswordSchema } from "@/lib/validation/auth";
import { personName } from "@/lib/validation/common";

const profileSchema = z.object({ name: personName, phone: z.string().max(30).optional() });
type ProfileInput = z.infer<typeof profileSchema>;
type PasswordFormInput = z.infer<typeof changePasswordSchema>;

export function ProfileForm({ phone }: { phone: string | null }) {
  const me = useAuth();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const profile = useForm<ProfileInput>({ resolver: zodResolver(profileSchema), defaultValues: { name: me.name, phone: phone ?? "" } });
  const pw = useForm<PasswordFormInput>({ resolver: zodResolver(changePasswordSchema) });

  const saveProfile = async (v: ProfileInput) => {
    try {
      await api("/api/me", { method: "PATCH", json: { name: v.name, phone: v.phone || null } });
      toast.success("Profile updated");
      router.refresh();
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not update profile"); }
  };

  const savePassword = async (v: PasswordFormInput) => {
    try {
      await api("/api/me/password", { method: "POST", json: v });
      toast.success("Password changed. Other sessions were signed out.");
      pw.reset();
    } catch (e) {
      if (e instanceof ClientApiError && e.code === "WRONG_PASSWORD") pw.setError("currentPassword", { message: e.message });
      else toast.error(e instanceof ClientApiError ? e.message : "Could not change password");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form onSubmit={profile.handleSubmit(saveProfile)} noValidate>
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle><CardDescription>How you appear to your team.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3"><Avatar name={me.name} src={me.avatarUrl} size="lg" /><div><p className="font-medium">{me.name}</p><p className="text-sm text-muted-foreground">{me.email}</p></div></div>
            <Field label="Name" htmlFor="p-name" error={profile.formState.errors.name?.message}><Input id="p-name" {...profile.register("name")} /></Field>
            <Field label="Phone" htmlFor="p-phone" error={profile.formState.errors.phone?.message}><Input id="p-phone" {...profile.register("phone")} /></Field>
            <Field label="Theme" htmlFor="p-theme">
              <NativeSelect id="p-theme" value={theme ?? "system"} onChange={(e) => setTheme(e.target.value)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></NativeSelect>
            </Field>
          </CardContent>
          <CardFooter className="justify-end"><Button type="submit" loading={profile.formState.isSubmitting}>Save profile</Button></CardFooter>
        </Card>
      </form>
      <form onSubmit={pw.handleSubmit(savePassword)} noValidate>
        <Card>
          <CardHeader><CardTitle>Password</CardTitle><CardDescription>Changing your password signs out your other devices.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Current password" htmlFor="pw-current" error={pw.formState.errors.currentPassword?.message}><PasswordInput id="pw-current" autoComplete="current-password" {...pw.register("currentPassword")} /></Field>
            <Field label="New password" htmlFor="pw-new" error={pw.formState.errors.newPassword?.message} hint="At least 8 characters with a letter and a number."><PasswordInput id="pw-new" autoComplete="new-password" {...pw.register("newPassword")} /></Field>
          </CardContent>
          <CardFooter className="justify-end"><Button type="submit" variant="outline" loading={pw.formState.isSubmitting}>Change password</Button></CardFooter>
        </Card>
      </form>
    </div>
  );
}

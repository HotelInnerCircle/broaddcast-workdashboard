"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Field } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/api/client";
import { password } from "@/lib/validation/common";
import { FormAlert } from "./auth-card";

const schema = z.object({ password, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });
type Input = z.infer<typeof schema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Input>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: Input) => {
    setError(null);
    try {
      await api("/api/auth/reset-password", { method: "POST", json: { token, password: values.password } });
      toast.success("Password updated. Please sign in.");
      router.push("/login");
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "Unable to reset password.");
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <FormAlert kind="error" message={error} />
      <Field label="New password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters with a letter and a number.">
        <PasswordInput id="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" error={errors.confirm?.message}>
        <PasswordInput id="confirm" autoComplete="new-password" aria-invalid={!!errors.confirm} {...register("confirm")} />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>Set new password</Button>
    </form>
  );
}

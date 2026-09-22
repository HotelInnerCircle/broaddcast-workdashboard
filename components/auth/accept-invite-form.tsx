"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Field } from "@/components/ui/label";
import { api, ClientApiError } from "@/lib/api/client";
import { acceptInviteSchema } from "@/lib/validation/auth";
import { FormAlert } from "./auth-card";

type Input = z.infer<typeof acceptInviteSchema>;

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Input>({ resolver: zodResolver(acceptInviteSchema) });

  const onSubmit = async (values: Input) => {
    setError(null);
    try {
      await api(`/api/invites/token/${token}/accept`, { method: "POST", json: values });
    } catch (e) {
      setError(e instanceof ClientApiError ? e.message : "Unable to accept the invitation.");
      return;
    }
    const res = await signIn("credentials", { email, password: values.password, redirect: false });
    window.location.assign(res && !res.error ? "/" : "/login");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <FormAlert kind="error" message={error} />
      <Field label="Email" htmlFor="email"><Input id="email" value={email} disabled /></Field>
      <Field label="Your name" htmlFor="name" error={errors.name?.message}>
        <Input id="name" autoComplete="name" aria-invalid={!!errors.name} {...register("name")} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters with a letter and a number.">
        <PasswordInput id="password" autoComplete="new-password" aria-invalid={!!errors.password} {...register("password")} />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>Activate account</Button>
    </form>
  );
}

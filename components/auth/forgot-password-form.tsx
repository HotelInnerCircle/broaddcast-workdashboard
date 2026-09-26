"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { api } from "@/lib/api/client";
import { forgotPasswordSchema } from "@/lib/validation/auth";
import { FormAlert } from "./auth-card";

type Input = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Input>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = async (values: Input) => {
    setError(null);
    try {
      const res = await api<{ message: string }>("/api/auth/forgot-password", { method: "POST", json: values });
      setDone(res.message);
    } catch {
      setError("Unable to process the request right now. Please try again.");
    }
  };

  if (done) return <FormAlert kind="success" message={done} />;
  return (
    <form method="post" onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <FormAlert kind="error" message={error} />
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!errors.email} {...register("email")} />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>Send reset link</Button>
    </form>
  );
}

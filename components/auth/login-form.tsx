"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Field } from "@/components/ui/label";
import { loginSchema, type LoginInput } from "@/lib/validation/auth";
import { FormAlert } from "./auth-card";

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Invalid email or password.",
  company_suspended: "Your company account is suspended. Please contact support.",
  account_inactive: "This account is not active. Ask your administrator for a new invitation.",
};

export function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [landing, setLanding] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginInput) => {
    setError(null);
    const res = await signIn("credentials", { ...values, redirect: false });
    if (!res || res.error) {
      const code = (res as { code?: string } | undefined)?.code ?? "";
      setError(MESSAGES[code] ?? (res?.status === 429 ? "Too many attempts. Please wait a minute." : "Unable to sign in. Please try again."));
      return;
    }
    // Keep the screen busy: the browser is about to leave, and a dead form for a second reads as
    // a failure. This stays up until the navigation replaces it.
    setLanding(true);

    const callbackUrl = params.get("callbackUrl");
    if (callbackUrl && callbackUrl.startsWith("/")) {
      window.location.assign(callbackUrl);
      return;
    }
    /*
     * Straight to "/", which resolves the session and redirects to this role's home.
     *
     * Asking the session endpoint for the role first and jumping directly was tried and measured
     * SLOWER - 2.0s against 1.5s - because that is a serial round trip before navigation starts,
     * while the redirect here happens inside a navigation the browser is already making.
     *
     * A full navigation rather than the router: the pre-login cache may hold a prefetched
     * "/" -> /login redirect.
     */
    window.location.assign("/");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <FormAlert kind="error" message={error} />
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" aria-invalid={!!errors.email} {...register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password?.message}>
        <PasswordInput id="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register("password")} />
      </Field>
      <div className="flex justify-end">
        <Link href="/forgot-password" className="text-sm text-primary hover:underline">Forgot password?</Link>
      </div>
      <Button type="submit" className="w-full" size="lg" loading={isSubmitting || landing}>{landing ? "Taking you in..." : "Sign in"}</Button>
    </form>
  );
}

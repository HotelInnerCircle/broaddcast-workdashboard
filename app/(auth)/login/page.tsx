import { Suspense } from "react";
import { AuthCard } from "@/components/auth/auth-card";
import { LoginForm } from "@/components/auth/login-form";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthCard title="Welcome back" subtitle="Sign in to your workspace." footer={<>Need a workspace? Companies are created by the platform administrator - ask them for an invitation.</>}>
      <Suspense><LoginForm /></Suspense>
    </AuthCard>
  );
}

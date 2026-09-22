import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard title="Reset your password" subtitle="Enter your email and we will send you a link to set a new password." footer={<Link href="/login" className="text-primary hover:underline">Back to sign in</Link>}>
      <ForgotPasswordForm />
    </AuthCard>
  );
}

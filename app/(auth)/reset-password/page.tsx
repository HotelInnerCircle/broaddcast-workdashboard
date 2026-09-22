import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata = { title: "Set a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <AuthCard title="Invalid link" subtitle="This password reset link is missing its token." footer={<Link href="/forgot-password" className="text-primary hover:underline">Request a new link</Link>}>
        <></>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Set a new password" subtitle="Choose a strong password for your account." footer={<Link href="/login" className="text-primary hover:underline">Back to sign in</Link>}>
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}

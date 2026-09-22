import Link from "next/link";
import { connectDB } from "@/lib/db/connect";
import { getInviteByToken } from "@/services/inviteService";
import { AuthCard } from "@/components/auth/auth-card";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABEL } from "@/types";

export const metadata = { title: "Accept invitation" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await connectDB();
  const invite = await getInviteByToken(token);
  if (!invite) {
    return (
      <AuthCard title="Invitation unavailable" subtitle="This invitation link is invalid, has expired, or was revoked. Ask your administrator to send a new one." footer={<Link href="/login" className="text-primary hover:underline">Go to sign in</Link>}>
        <></>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={`Join ${invite.companyName}`} subtitle="Set your name and password to activate your account.">
      <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">You are joining as <Badge variant="primary">{ROLE_LABEL[invite.role]}</Badge></div>
      <AcceptInviteForm token={token} email={invite.email} />
    </AuthCard>
  );
}

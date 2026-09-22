import { requirePageSession } from "@/lib/auth/context";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

/** Server-side session check for every dashboard route (spec 6.5), on top of the middleware gate. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePageSession();
  return <AppShell session={session}>{children}</AppShell>;
}

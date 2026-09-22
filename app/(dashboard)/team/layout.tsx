import { requirePageRole } from "@/lib/auth/context";

/** Only TEAM_LEAD may enter /team/* (spec 6.5). Other roles are sent to their own dashboard. */
export default async function RoleLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole("TEAM_LEAD");
  return <>{children}</>;
}

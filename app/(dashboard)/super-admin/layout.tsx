import { requirePageRole } from "@/lib/auth/context";

/** Only SUPER_ADMIN may enter /super-admin/* (spec 6.5). Other roles are sent to their own dashboard. */
export default async function RoleLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole("SUPER_ADMIN");
  return <>{children}</>;
}

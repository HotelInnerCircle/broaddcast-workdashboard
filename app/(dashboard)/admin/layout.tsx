import { requirePageRole } from "@/lib/auth/context";

/** Only COMPANY_ADMIN may enter /admin/* (spec 6.5). Other roles are sent to their own dashboard. */
export default async function RoleLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole("COMPANY_ADMIN");
  return <>{children}</>;
}

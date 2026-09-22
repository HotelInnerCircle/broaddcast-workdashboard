import { requirePageRole } from "@/lib/auth/context";

/** Only EMPLOYEE may enter /employee/* (spec 6.5). Other roles are sent to their own dashboard. */
export default async function RoleLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole("EMPLOYEE");
  return <>{children}</>;
}

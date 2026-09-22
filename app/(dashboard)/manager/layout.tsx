import { requirePageRole } from "@/lib/auth/context";

/** Only MANAGER may enter /manager/* (spec 6.5). Other roles are sent to their own dashboard. */
export default async function RoleLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole("MANAGER");
  return <>{children}</>;
}

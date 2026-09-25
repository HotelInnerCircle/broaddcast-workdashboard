import { requirePageRole } from "@/lib/auth/context";

/** Only HR may enter /hr/* (A83). Other roles are sent to their own dashboard. */
export default async function RoleLayout({ children }: { children: React.ReactNode }) {
  await requirePageRole("HR");
  return <>{children}</>;
}

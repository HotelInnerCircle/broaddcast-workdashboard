import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth/context";
import { ROLE_HOME } from "@/types";

/** Root: send the user to their role home (spec 6.5) or to login. */
export default async function RootPage() {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  redirect(ROLE_HOME[ctx.role]);
}

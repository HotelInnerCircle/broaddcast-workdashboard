import { requirePagePermission } from "@/lib/auth/context";
import { TeamsView } from "@/components/teams/teams-view";

export const metadata = { title: "Teams" };

export default async function TeamsPage() {
  await requirePagePermission("teams", "view");
  return <TeamsView />;
}

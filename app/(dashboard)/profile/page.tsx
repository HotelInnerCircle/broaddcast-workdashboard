import { requirePageSession } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/page-header";
import { ProfileView } from "@/components/layout/profile-view";

export const metadata = { title: "Profile" };

/** A89: on a phone this is the menu. On desktop the sidebar already is, but the page still works. */
export default async function ProfilePage() {
  await requirePageSession();
  return (
    <>
      <PageHeader title="Profile" description="Your account, and everything in the app." />
      <ProfileView />
    </>
  );
}

import { Types } from "mongoose";
import { requirePageSession, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { can } from "@/lib/permissions";
import { getCompany } from "@/services/companyService";
import { User } from "@/models/User";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FaceCheckSettings } from "@/components/settings/face-check-settings";
import { DoorDevices } from "@/components/settings/door-devices";
import { EnrolInPerson } from "@/components/settings/enrol-in-person";
import { CompanySettingsForm } from "@/components/settings/company-settings-form";
import { ListEditor } from "@/components/settings/list-editor";
import { ApprovalChainEditor } from "@/components/settings/approval-chain-editor";
import { ProfileForm } from "@/components/settings/profile-form";
import { SubscriptionView, BillingView } from "@/components/settings/subscription-view";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requirePageSession();
  const { tab } = await searchParams;
  await connectDB();
  const isAdmin = ctx.companyId ? can(ctx.role, "companySettings", "view") : false;
  const [company, me] = await Promise.all([
    isAdmin ? getCompany(ctx as CompanyContext) : null,
    User.findById(new Types.ObjectId(ctx.userId)).select("phone").lean(),
  ]);
  const defaultTab = tab && ["company", "profile", "face", "subscription", "billing"].includes(tab) ? tab : isAdmin ? "company" : "profile";

  return (
    <>
      <PageHeader title="Settings" description={isAdmin ? "Company configuration and your personal preferences." : "Your personal preferences."} />
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          {isAdmin && <TabsTrigger value="company">Company</TabsTrigger>}
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {/* Its own tab: the switch and the approvals are one decision, and both belong away from the general company form. */}
          {isAdmin && <TabsTrigger value="face">Face check</TabsTrigger>}
          {isAdmin && <TabsTrigger value="subscription">Subscription</TabsTrigger>}
          {isAdmin && <TabsTrigger value="billing">Billing</TabsTrigger>}
        </TabsList>
        {isAdmin && <TabsContent value="face" className="space-y-6">
          <FaceCheckSettings />
          {/*
            Enrolling in person sits with the door devices (A132), because that
            is the order somebody does it in: hang a tablet by a gate, then walk
            the people who will use it past a desk and photograph them. A door
            recognises nobody until somebody has been enrolled and approved, so
            the two belong on the same screen.
          */}
          <DoorDevices />
          <EnrolInPerson />
        </TabsContent>}
        {company && <TabsContent value="company" className="space-y-6"><CompanySettingsForm company={company} />
          <ApprovalChainEditor initial={company.approvalChain} />
          <ListEditor
            field="services"
            initial={company.services}
            title="Services you offer"
            description="What clients can buy from you - e.g. Creatives, Meta Ads. Tick the ones each client has taken on their client page."
            placeholder="Add a service, e.g. Meta Ads"
            suggestions={["Creatives", "Meta Ads", "Google Ads", "Truecaller", "SEO", "Website", "Social Media", "WhatsApp Marketing"]}
          />
          <ListEditor
            field="designations"
            initial={company.designations}
            title="Job designations"
            description="Job titles your people can be assigned - e.g. Web Developer, Designer. They appear in the Designation dropdown when you add or edit an employee."
            placeholder="Add a designation, e.g. Web Developer"
            suggestions={["Web Developer", "Mobile Developer", "UI/UX Designer", "Graphic Designer", "Project Manager", "QA Engineer", "Business Analyst", "Digital Marketer"]}
          /></TabsContent>}
        <TabsContent value="profile"><ProfileForm phone={me?.phone ?? null} /></TabsContent>
        {isAdmin && <TabsContent value="subscription"><SubscriptionView /></TabsContent>}
        {isAdmin && <TabsContent value="billing"><BillingView /></TabsContent>}
      </Tabs>
    </>
  );
}

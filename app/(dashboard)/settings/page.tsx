import { Types } from "mongoose";
import { requirePageSession, type CompanyContext } from "@/lib/auth/context";
import { connectDB } from "@/lib/db/connect";
import { can } from "@/lib/permissions";
import { getCompany } from "@/services/companyService";
import { User } from "@/models/User";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const defaultTab = tab && ["company", "profile", "subscription", "billing"].includes(tab) ? tab : isAdmin ? "company" : "profile";

  return (
    <>
      <PageHeader title="Settings" description={isAdmin ? "Company configuration and your personal preferences." : "Your personal preferences."} />
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          {isAdmin && <TabsTrigger value="company">Company</TabsTrigger>}
          <TabsTrigger value="profile">Profile</TabsTrigger>
          {isAdmin && <TabsTrigger value="subscription">Subscription</TabsTrigger>}
          {isAdmin && <TabsTrigger value="billing">Billing</TabsTrigger>}
        </TabsList>
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

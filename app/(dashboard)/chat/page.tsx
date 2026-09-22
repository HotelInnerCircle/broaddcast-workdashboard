import { Suspense } from "react";
import { requirePagePermission } from "@/lib/auth/context";
import { ChatView } from "@/components/chat/chat-view";
import { DashboardLoading } from "@/components/skeletons/dashboard-loading";

export const metadata = { title: "Chat" };

export default async function ChatPage() {
  await requirePagePermission("chat", "view");
  return <Suspense fallback={<DashboardLoading />}><ChatView /></Suspense>;
}

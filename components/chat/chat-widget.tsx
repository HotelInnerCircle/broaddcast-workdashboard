"use client";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useChat } from "@/hooks/useChat";
import { ConversationList } from "./chat-view";
import { Thread } from "./thread";

/** Dashboard chat widget (spec 12.15): reply without leaving the dashboard. */
export function ChatWidget() {
  const chat = useChat();
  const active = chat.conversations?.find((c) => c.id === chat.activeId);
  return (
    <Card className="flex h-[440px] flex-col overflow-hidden">
      <CardHeader className="flex-row items-center justify-between border-b border-border py-3">
        <div className="flex items-center gap-2">
          {active && <Button variant="ghost" size="icon" onClick={() => chat.setActiveId(null)} aria-label="Back"><ArrowLeft /></Button>}
          <div><CardTitle>{active ? active.name.replace(/^# /, "") : "Chat"}</CardTitle>{!active && <CardDescription>Recent conversations</CardDescription>}</div>
        </div>
        <Button asChild variant="ghost" size="sm"><Link href={active ? `/chat?c=${active.id}` : "/chat"}><ExternalLink />Open</Link></Button>
      </CardHeader>
      <div className="min-h-0 flex-1">{active ? <Thread chat={chat} compact /> : <ConversationList chat={chat} compact />}</div>
    </Card>
  );
}

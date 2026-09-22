"use client";
import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { useChat } from "@/hooks/useChat";
import { Thread } from "./thread";

/** Project chat tab (spec 12.11): the project channel embedded in the project page. */
export function ProjectChat({ projectId }: { projectId: string }) {
  const chat = useChat();
  const conv = chat.conversations?.find((c) => c.type === "project" && c.projectId === projectId) ?? null;
  useEffect(() => { if (conv && chat.activeId !== conv.id) chat.setActiveId(conv.id); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [conv?.id]);
  return <Card className="flex h-[480px] flex-col overflow-hidden">{chat.conversations === null ? <p className="p-4 text-sm text-muted-foreground">Loading...</p> : !conv ? <p className="p-4 text-sm text-muted-foreground">You are not a member of this project channel.</p> : <Thread chat={chat} />}</Card>;
}

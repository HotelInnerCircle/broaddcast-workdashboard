"use client";
import { createContext, useContext } from "react";
import type { SessionContext } from "@/types";
import { can, type Action, type Resource } from "@/lib/permissions";

const Ctx = createContext<SessionContext | null>(null);

export function SessionProvider({ value, children }: { value: SessionContext; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Client-side access to the server-resolved session. Never used for authorization - only for rendering. */
export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside SessionProvider");
  return { ...ctx, can: (resource: Resource, action: Action) => can(ctx.role, resource, action) };
}

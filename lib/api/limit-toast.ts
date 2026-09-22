import { toast } from "sonner";
import { ClientApiError } from "./client";

/** Shared upgrade prompt for PLAN_LIMIT_REACHED (spec section 15). Returns true when it handled the error. */
export function showLimitError(e: unknown, navigate?: (href: string) => void): boolean {
  if (!(e instanceof ClientApiError) || e.code !== "PLAN_LIMIT_REACHED") return false;
  const d = e.details as { key?: string; used?: number; limit?: number; plan?: string; upgradeUrl?: string };
  toast.error(e.message, {
    description: d.plan ? `${d.plan} plan: ${d.used ?? "?"} of ${d.limit ?? "?"} ${d.key ?? ""} used.` : undefined,
    action: { label: "View plans", onClick: () => (navigate ? navigate(d.upgradeUrl ?? "/settings?tab=subscription") : (window.location.href = d.upgradeUrl ?? "/settings?tab=subscription")) },
    duration: 8000,
  });
  return true;
}

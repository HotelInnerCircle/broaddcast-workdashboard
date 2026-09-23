"use client";
import { brand } from "@/config/brand";
import { useCallback, useEffect, useState } from "react";
import { Check, CreditCard, Sparkles, Receipt, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api, ClientApiError } from "@/lib/api/client";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils/cn";

export interface PlanDto { id: string; name: string; limits: { users: number; projects: number; clients: number; storageMB: number }; features: string[]; price: number; yearlyPrice: number; currency: string; isDefault: boolean }
interface SubDto { plan: PlanDto | null; usage: { users: number; projects: number; clients: number; storageMB: number }; subscription: { id: string; status: string; billingCycle: string; currentPeriodStart: string; currentPeriodEnd: string; provider: string; payments: { id: string; provider: string; orderId: string | null; paymentId: string | null; amount: number; currency: string; periodStart: string; periodEnd: string; note: string | null; createdAt: string }[] } | null; billing: { provider: string; enabled: boolean; supportEmail: string } }
interface CheckoutDto { free: boolean; planId?: string; order?: { orderId: string; amount: number; currency: string; keyId: string }; plan?: PlanDto; cycle?: "monthly" | "yearly"; prefill?: { name: string; email: string } }
declare global { interface Window { Razorpay?: new (opts: Record<string, unknown>) => { open: () => void } } }

const fmt = (n: number, c = "INR") => new Intl.NumberFormat("en-IN", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n);
const limitLabel = (n: number) => (n < 0 ? "Unlimited" : n.toLocaleString());

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script"); s.src = "https://checkout.razorpay.com/v1/checkout.js"; s.onload = () => resolve(true); s.onerror = () => resolve(false); document.body.appendChild(s);
  });
}

export function UsageBar({ label, used, limit, unit = "" }: { label: string; used: number; limit: number; unit?: string }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs"><span className="font-medium">{label}</span><span className="text-muted-foreground">{used}{unit} / {limit < 0 ? "unlimited" : `${limit}${unit}`}</span></div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

/** Subscription tab (spec 12.6 / 12.23 / Phase 6): current plan, usage vs limits, plan comparison, upgrade. */
export function SubscriptionView() {
  const [data, setData] = useState<SubDto | null>(null);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => { try { const [s, p] = await Promise.all([api<SubDto>("/api/billing/subscription"), api<PlanDto[]>("/api/billing/plans")]); setData(s); setPlans(p); } catch { toast.error("Could not load subscription"); } }, []);
  useEffect(() => { void load(); }, [load]);

  const upgrade = async (plan: PlanDto) => {
    setBusy(plan.id);
    try {
      const r = await api<CheckoutDto>("/api/billing/checkout", { method: "POST", json: { planId: plan.id, cycle } });
      if (r.free) { toast.success(`Switched to ${plan.name}`); await load(); return; }
      if (!(await loadRazorpay()) || !window.Razorpay || !r.order) { toast.error("Payment page could not be loaded"); return; }
      const rz = new window.Razorpay({
        key: r.order.keyId, amount: Math.round(r.order.amount * 100), currency: r.order.currency, order_id: r.order.orderId,
        name: "WorkPulse", description: `${plan.name} plan (${cycle})`, prefill: r.prefill,
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try { await api("/api/billing/confirm", { method: "POST", json: { orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature, planId: plan.id, cycle } }); toast.success(`Welcome to ${plan.name}!`); await load(); }
          catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Payment could not be confirmed - support will verify it shortly"); }
        },
        theme: { color: brand.primaryHex },
      });
      rz.open();
    } catch (e) {
      if (e instanceof ClientApiError && e.code === "BILLING_DISABLED") toast.info("Online payments are not enabled", { description: `Email ${(e.details as { supportEmail?: string }).supportEmail ?? "support"} to change your plan; the platform administrator assigns plans manually.` });
      else toast.error(e instanceof ClientApiError ? e.message : "Could not start checkout");
    } finally { setBusy(null); }
  };

  if (!data) return <div className="space-y-4"><Skeleton className="h-40" /><Skeleton className="h-64" /></div>;
  const current = data.plan;
  const sub = data.subscription;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" />Current plan</CardTitle><CardDescription>{sub ? `${sub.status} - ${sub.billingCycle}, renews ${formatDate(sub.currentPeriodEnd)}` : "Assigned by the platform administrator"}</CardDescription></CardHeader>
          <CardContent className="pt-0">
            <p className="text-3xl font-semibold">{current?.name ?? "No plan"}</p>
            {current && <p className="text-sm text-muted-foreground">{current.price === 0 ? "Free" : `${fmt(current.price, current.currency)} / month`}</p>}
            {sub && <Badge variant={sub.status === "active" ? "success" : sub.status === "past_due" ? "danger" : "warning"} className="mt-2">{sub.status}</Badge>}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Usage vs limits</CardTitle><CardDescription>Creation is blocked with an upgrade prompt when a limit is reached.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 pt-0 sm:grid-cols-2">
            <UsageBar label="Users" used={data.usage.users} limit={current?.limits.users ?? -1} />
            <UsageBar label="Projects" used={data.usage.projects} limit={current?.limits.projects ?? -1} />
            <UsageBar label="Clients" used={data.usage.clients} limit={current?.limits.clients ?? -1} />
            <UsageBar label="Storage" used={data.usage.storageMB} limit={current?.limits.storageMB ?? -1} unit=" MB" />
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between"><h2 className="font-semibold">Plans</h2><div className="inline-flex rounded-full bg-muted p-1">{(["monthly", "yearly"] as const).map((c) => <button key={c} onClick={() => setCycle(c)} className={cn("h-8 rounded-full px-3.5 text-sm capitalize transition-colors", cycle === c ? "bg-foreground font-medium text-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{c}{c === "yearly" && <span className="ml-1 text-[10px] text-success">2 months free</span>}</button>)}</div></div>
      {!data.billing.enabled && <p className="text-sm text-muted-foreground">Online payments are not enabled on this installation. Plans are assigned by the platform administrator - contact <a className="text-primary hover:underline" href={`mailto:${data.billing.supportEmail}`}>{data.billing.supportEmail}</a> to change yours.</p>}
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = current?.id === p.id;
          const priceNow = cycle === "yearly" ? p.yearlyPrice : p.price;
          return (
            <Card key={p.id} className={cn("flex flex-col", isCurrent && "border-primary ring-1 ring-primary")}>
              <CardHeader><CardTitle className="flex items-center justify-between">{p.name}{isCurrent && <Badge variant="primary">Current</Badge>}{p.name === "Business" && !isCurrent && <Badge variant="success"><Sparkles className="size-3" />Popular</Badge>}</CardTitle><CardDescription>{priceNow === 0 ? "Free forever" : `${fmt(priceNow, p.currency)} / ${cycle === "yearly" ? "year" : "month"}`}</CardDescription></CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3 pt-0 text-sm">
                <ul className="space-y-1.5">
                  <li className="flex items-center gap-2"><Check className="size-4 text-success" />{limitLabel(p.limits.users)} users</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-success" />{limitLabel(p.limits.projects)} projects</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-success" />{limitLabel(p.limits.clients)} clients</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-success" />{p.limits.storageMB < 0 ? "Unlimited" : `${(p.limits.storageMB / 1024).toFixed(p.limits.storageMB >= 1024 ? 0 : 1)} GB`} storage</li>
                  {p.features.map((f) => <li key={f} className="flex items-center gap-2 text-muted-foreground"><Check className="size-4 text-muted-foreground" />{f.replace(/-/g, " ")}</li>)}
                </ul>
                <div className="mt-auto pt-2">
                  {isCurrent ? <Button variant="outline" className="w-full" disabled>Your plan</Button> : <Button className="w-full" loading={busy === p.id} onClick={() => upgrade(p)}><CreditCard />{priceNow === 0 ? "Switch to free" : (current && priceNow < current.price ? "Downgrade" : "Upgrade")}</Button>}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** Billing tab: payment history from the subscription record. Invoices are reserved for later. */
export function BillingView() {
  const [data, setData] = useState<SubDto | null>(null);
  useEffect(() => { api<SubDto>("/api/billing/subscription").then(setData).catch(() => setData(null)); }, []);
  if (!data) return <Skeleton className="h-48" />;
  const payments = data.subscription?.payments ?? [];
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Receipt className="size-4" />Billing history</CardTitle><CardDescription>Payments and plan assignments. Provider: {data.billing.provider}{data.billing.enabled ? "" : " (not configured)"}.</CardDescription></CardHeader>
      <CardContent className="p-0 pt-0">
        {payments.length === 0 ? <EmptyState icon={Receipt} title="No payments yet" description="Payments and manual plan assignments will be listed here." /> : (
          <Table>
            <THead><TR><TH>Date</TH><TH>Description</TH><TH>Period</TH><TH className="text-right">Amount</TH><TH>Reference</TH></TR></THead>
            <TBody>{payments.map((p) => <TR key={p.id}><TD label="Date" className="whitespace-nowrap">{formatDateTime(p.createdAt)}</TD><TD primary>{p.note ?? (p.provider === "manual" ? "Plan assigned" : `Payment via ${p.provider}`)}</TD><TD label="Period" className="whitespace-nowrap text-muted-foreground">{formatDate(p.periodStart)} - {formatDate(p.periodEnd)}</TD><TD label="Amount" className="text-right tabular-nums">{p.amount ? fmt(p.amount, p.currency) : "-"}</TD><TD className="font-mono text-xs text-muted-foreground">{p.paymentId ?? p.orderId ?? "-"}</TD></TR>)}</TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

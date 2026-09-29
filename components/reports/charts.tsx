"use client";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/** Fixed categorical order (never cycled); the 9th+ series folds into "Other" upstream. */
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)"];

export function ChartCard({ title, description, children, empty }: { title: string; description?: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader>
      <CardContent className="pt-0">{empty ? <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">No data for this range.</div> : children}</CardContent>
    </Card>
  );
}

/*
 * Each chart is fetched the moment one is rendered, and not before (A122).
 *
 * recharts is the heaviest thing on these pages and it was arriving with every
 * page that imported ChartCard, whether a chart was on screen or not. The
 * placeholder is the same height the chart will be, so nothing jumps when it
 * arrives.
 */
const Placeholder = ({ height = 224 }: { height?: number }) => (
  <div style={{ height }} className="animate-pulse rounded-xl bg-muted/60" />
);

export const HBars = dynamic(() => import("./charts-impl").then((m) => m.HBars), {
  ssr: false, loading: () => <Placeholder />,
}) as (p: { data: { name: string; value: number }[]; unit?: string; height?: number }) => React.ReactElement;

export const Trend = dynamic(() => import("./charts-impl").then((m) => m.Trend), {
  ssr: false, loading: () => <Placeholder />,
}) as (p: { data: { date: string; value: number }[]; unit?: string }) => React.ReactElement;

export const PairedBars = dynamic(() => import("./charts-impl").then((m) => m.PairedBars), {
  ssr: false, loading: () => <Placeholder />,
}) as (p: { data: Record<string, string | number>[]; aKey: string; bKey: string; aLabel: string; bLabel: string; unit?: string }) => React.ReactElement;

export const Donut = dynamic(() => import("./charts-impl").then((m) => m.Donut), {
  ssr: false, loading: () => <Placeholder />,
}) as (p: { data: { name: string; value: number }[]; total?: number }) => React.ReactElement;

"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/** Fixed categorical order (never cycled); the 9th+ series folds into "Other" upstream. */
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--chart-6)", "var(--chart-7)", "var(--chart-8)"];
const tooltipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--foreground)" };
const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };

export function ChartCard({ title, description, children, empty }: { title: string; description?: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader>
      <CardContent className="pt-0">{empty ? <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">No data for this range.</div> : children}</CardContent>
    </Card>
  );
}

/** Horizontal bars for identity + magnitude (hours by employee/client/project). Single series: no legend, direct values. */
export function HBars({ data, unit = "h", height }: { data: { name: string; value: number }[]; unit?: string; height?: number }) {
  const h = height ?? Math.max(160, data.length * 32 + 24);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" strokeDasharray="2 4" />
        <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} unit={unit} />
        <YAxis type="category" dataKey="name" width={120} tick={axisTick} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v) => [`${v}${unit}`, "Hours"]} />
        <Bar dataKey="value" fill="var(--chart-single)" radius={[0, 4, 4, 0]} barSize={14} label={{ position: "right", fill: "var(--muted-foreground)", fontSize: 11, formatter: (v: unknown) => `${v}${unit}` }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Change over time (work over time). Single series area with crosshair tooltip. */
export function Trend({ data, unit = "h" }: { data: { date: string; value: number }[]; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
        <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-single)" stopOpacity={0.25} /><stop offset="100%" stopColor="var(--chart-single)" stopOpacity={0} /></linearGradient></defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="2 4" />
        <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} unit={unit} width={40} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`${v}${unit}`, "Hours"]} />
        <Area type="monotone" dataKey="value" stroke="var(--chart-single)" strokeWidth={2} fill="url(#trendFill)" dot={{ r: 3, fill: "var(--chart-single)", strokeWidth: 0 }} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Two-series comparison on one axis (tracked vs estimated hours per project). Legend + tooltip. */
export function PairedBars({ data, aKey, bKey, aLabel, bLabel, unit = "h" }: { data: Record<string, string | number>[]; aKey: string; bKey: string; aLabel: string; bLabel: string; unit?: string }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 40 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }} barCategoryGap={10} barGap={2}>
        <CartesianGrid horizontal={false} stroke="var(--chart-grid)" strokeDasharray="2 4" />
        <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} unit={unit} />
        <YAxis type="category" dataKey="name" width={140} tick={axisTick} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} formatter={(v, n) => [`${v}${unit}`, n === aKey ? aLabel : bLabel]} />
        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === aKey ? aLabel : bLabel)} />
        <Bar dataKey={aKey} fill="var(--chart-1)" radius={[0, 4, 4, 0]} barSize={10} />
        <Bar dataKey={bKey} fill="var(--chart-2)" radius={[0, 4, 4, 0]} barSize={10} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Part-to-whole with few slices (tasks by status). Legend always present; total in the centre. */
export function Donut({ data, total }: { data: { name: string; value: number }[]; total?: number }) {
  const sum = total ?? data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={85} paddingAngle={2} stroke="var(--card)" strokeWidth={2}>
            {data.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute left-1/2 top-[88px] -translate-x-1/2 text-center"><p className="text-2xl font-semibold tabular-nums">{sum}</p><p className="text-[11px] text-muted-foreground">total</p></div>
    </div>
  );
}

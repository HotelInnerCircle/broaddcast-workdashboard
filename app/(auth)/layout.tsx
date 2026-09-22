import { Activity, Clock3, ShieldCheck, Users } from "lucide-react";
import { brand } from "@/config/brand";
import { BrandMark } from "@/components/layout/brand-mark";

const points = [
  { icon: Activity, text: "See who is working on what, live" },
  { icon: Clock3, text: "One simple timer: Client, Project, Task" },
  { icon: Users, text: "Teams, attendance and daily reports in one place" },
  { icon: ShieldCheck, text: "Every company fully isolated and audited" },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2 lg:gap-4 lg:p-4">
      <aside className="hidden flex-col justify-between rounded-2xl bg-sidebar p-10 text-white shadow-float lg:flex">
        <BrandMark className="text-white" />
        <div className="max-w-md space-y-8">
          <h2 className="font-display text-[44px] leading-[1.05]">{brand.tagline}</h2>
          <ul className="space-y-4 text-sm text-white/75">
            {points.map((p) => (
              <li key={p.text} className="flex items-center gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/8"><p.icon className="size-[18px] text-white/90" /></span>{p.text}</li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-white/50">&copy; {new Date().getFullYear()} {brand.name}</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><BrandMark /></div>
          {children}
        </div>
      </main>
    </div>
  );
}

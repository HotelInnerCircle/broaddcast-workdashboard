export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="animate-in">
      <h1 className="font-display text-[34px] leading-none">{title}</h1>
      {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-8">{children}</div>
      {footer && <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>}
    </div>
  );
}

export function FormAlert({ kind, message }: { kind: "error" | "success"; message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className={kind === "error" ? "rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" : "rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success"}>
      {message}
    </div>
  );
}

import Link from "next/link";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils/cn";

export function BrandMark({ collapsed, href = "/", className, companyName, companyLogoUrl }: { collapsed?: boolean; href?: string; className?: string; companyName?: string | null; companyLogoUrl?: string | null }) {
  const logo = companyLogoUrl ?? brand.logoUrl;
  const name = companyName ?? brand.name;
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 font-semibold", className)}>
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt={name} className="size-10 rounded-[14px] object-cover" />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-primary text-[13px] font-bold text-primary-foreground shadow-[0_8px_20px_-8px_var(--primary)]">{brand.logoText}</span>
      )}
      {!collapsed && <span className="truncate font-display text-[22px] leading-none">{name}</span>}
    </Link>
  );
}

import Link from "next/link";
import { brand } from "@/config/brand";
import { cn } from "@/lib/utils/cn";

/**
 * Company logo (or the product mark when none is uploaded). The logo is never cropped: it sits on a
 * white rounded tile with `object-contain`, square in the icon rail and up to the full sidebar width
 * when expanded, so wordmarks and square marks both render correctly.
 */
export function BrandMark({ collapsed, wide, href = "/", className, companyName, companyLogoUrl }: { collapsed?: boolean; /** Wider tile for the expanded sidebar (logo only, no name). */ wide?: boolean; href?: string; className?: string; companyName?: string | null; companyLogoUrl?: string | null }) {
  const logo = companyLogoUrl ?? brand.logoUrl;
  const name = companyName ?? brand.name;
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 font-semibold", className)} title={name}>
      {logo ? (
        <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-white shadow-[0_6px_18px_-8px_rgb(0_0_0/0.35)]", wide ? "h-14 w-full max-w-[200px] px-3" : "size-12 p-1.5")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt={name} className="h-full w-full object-contain" />
        </span>
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-primary text-[13px] font-bold text-primary-foreground shadow-[0_8px_20px_-8px_var(--primary)]">{brand.logoText}</span>
      )}
      {!collapsed && !wide && <span className="truncate font-display text-[22px] leading-none">{name}</span>}
    </Link>
  );
}

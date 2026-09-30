import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import type { NavGroup } from "@/config/navigation";

/**
 * Everything the company can do, on one screen (A129).
 *
 * The owner's reference is a wall of named links in coloured columns, and the
 * reason it works is that it is *complete*: somebody who knows the name of the
 * thing they want finds it without hunting through a sidebar, and somebody who
 * does not can read the whole system in one go.
 *
 * Desktop only, deliberately. A phone gets the launcher it already has - four
 * tiles and today's swipes - because ninety links on a five-inch screen is a
 * list nobody scrolls. This is the screen somebody sits down at.
 *
 * It is built from the navigation config rather than a second hand-written
 * list, so an item hidden by an admin, or one this role may not see, is absent
 * here too. A gateway that showed a link the sidebar hides would be a gateway
 * that lies.
 */

/** Groups, in the order somebody would work through them rather than alphabetically. */
const COLUMN_TONES = [
  "bg-tile-success text-tile-success-fg",
  "bg-tile-warning text-tile-warning-fg",
  "bg-tile-danger text-tile-danger-fg",
  "bg-tile-info text-tile-info-fg",
  "bg-tile-default text-tile-default-fg",
  "bg-tile-muted text-tile-muted-fg",
];

export interface GatewaySection {
  label: string;
  /** Things that exist. */
  items: { label: string; href: string }[];
  /** Named, and honestly marked as not built - see the note below. */
  missing?: string[];
}

export function WorkGateway({ groups, extra }: { groups: NavGroup[]; extra: GatewaySection[] }) {
  const sections: GatewaySection[] = [
    ...groups.map((g): GatewaySection => ({ label: g.label, items: g.items.map((i) => ({ label: i.label, href: i.href })) })),
    ...extra,
  ].filter((s) => s.items.length > 0 || (s.missing?.length ?? 0) > 0);

  return (
    <section className="hidden md:block" aria-label="Everything you can do">
      <div className="columns-1 gap-4 lg:columns-2 xl:columns-3 2xl:columns-4">
        {sections.map((s, i) => (
          <div key={s.label} className="mb-4 break-inside-avoid overflow-hidden rounded-2xl ring-1 ring-border/60">
            <p className={cn("px-4 py-2 text-center text-[12px] font-bold uppercase tracking-[0.08em]", COLUMN_TONES[i % COLUMN_TONES.length])}>
              {s.label}
            </p>
            <div className="bg-card">
              {s.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block px-4 py-2 text-center text-[13.5px] transition-colors hover:bg-muted hover:text-primary"
                >
                  {item.label}
                </Link>
              ))}
              {/*
                Named rather than omitted. A gateway that silently leaves things
                out reads as a finished system missing nothing, and then
                somebody plans around a report that does not exist. Greyed and
                unclickable says the true thing: this is on the list.
              */}
              {s.missing?.map((label) => (
                <p key={label} className="px-4 py-2 text-center text-[13.5px] text-muted-foreground/45" title="Not built yet">
                  {label}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
        Greyed names are not built yet. Everything else is live.
      </p>
    </section>
  );
}

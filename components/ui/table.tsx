import * as React from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Data table that becomes a card list on phones (A67).
 *
 * Every table in the app uses `cards` (the default): below `md` each row renders as a card, the
 * header row is hidden and each cell shows its column name from `TD`'s `label` prop. Give the cell
 * that identifies the row `primary` so it becomes the card's heading, and set `hideOnMobile` on
 * cells that only repeat what the heading already says. Pass `cards={false}` for a table that must
 * stay a grid (a numeric matrix), which then scrolls sideways inside its own container.
 */
export function Table({ className, cards = true, ...props }: React.HTMLAttributes<HTMLTableElement> & { cards?: boolean }) {
  return (
    <div className={cn("w-full", cards ? "md:overflow-x-auto" : "overflow-x-auto")}>
      <table className={cn("w-full caption-bottom text-sm", cards && "table-cards", className)} {...props} />
    </div>
  );
}
export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("[&_tr]:border-0", className)} {...props} />;
}
export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("[&_tr:nth-child(odd)]:bg-muted/45", className)} {...props} />;
}
export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-0 transition-colors hover:bg-muted [&>td:first-child]:rounded-l-xl [&>td:last-child]:rounded-r-xl", className)} {...props} />;
}
export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("h-9 px-4 text-left align-middle text-xs font-semibold text-muted-foreground", className)} {...props} />;
}
export function TD({ className, label, primary, hideOnMobile, ...props }: React.TdHTMLAttributes<HTMLTableCellElement> & {
  /** Column name shown beside the value in the phone card. */
  label?: string;
  /** This cell identifies the row: it becomes the card heading. */
  primary?: boolean;
  /** Redundant on a phone (already in the heading): hidden there, shown from `md` up. */
  hideOnMobile?: boolean;
}) {
  return (
    <td
      data-label={label}
      data-primary={primary ? "" : undefined}
      className={cn("px-4 py-3 align-middle", hideOnMobile && "max-md:hidden", className)}
      {...props}
    />
  );
}

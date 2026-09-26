"use client";

import { useEffect, useState } from "react";
import { relativeTime } from "@/lib/utils/dates";

/**
 * "2 minutes ago", without the hydration error that comes free with it.
 *
 * `relativeTime` reads the clock. The server reads it when it renders the page
 * and the browser reads it again when it hydrates, and if a minute boundary
 * falls between the two the strings differ - "1 minute ago" against "2 minutes
 * ago" - which React reports as a hydration mismatch and then repaints the
 * subtree around. It is the one case `suppressHydrationWarning` is meant for:
 * the difference is expected, and the server's answer was not wrong when it was
 * written.
 *
 * Suppressing the warning leaves React showing the server's text, so the effect
 * writes the browser's own answer straight after mount. From then on it ticks,
 * which is what somebody watching a dashboard expects of "Last active" anyway.
 *
 * The <time> element carries the machine-readable timestamp, so the exact moment
 * is available to a screen reader and on hover even though the text is fuzzy.
 */
export function RelativeTime({
  value,
  className,
  everyMs = 30_000,
}: {
  value: Date | string | null | undefined;
  className?: string;
  /** How often to redraw. Half a minute keeps "x minutes ago" honest. */
  everyMs?: number;
}) {
  const [text, setText] = useState(() => relativeTime(value));

  useEffect(() => {
    const tick = () => setText(relativeTime(value));
    tick();
    if (!value) return;
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [value, everyMs]);

  if (!value) return <span className={className}>{text}</span>;

  const iso = (typeof value === "string" ? new Date(value) : value).toISOString();
  return (
    <time dateTime={iso} title={iso} className={className} suppressHydrationWarning>
      {text}
    </time>
  );
}

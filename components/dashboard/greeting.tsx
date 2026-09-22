import { formatInTimeZone } from "date-fns-tz";
import { greeting } from "@/lib/utils/dates";

export function Greeting({ name, timezone, subtitle }: { name: string; timezone: string; subtitle?: string }) {
  const now = new Date();
  return (
    <div className="mb-7">
      <h1 className="font-display text-[32px] leading-none">{greeting(timezone, now)}, <em>{name.split(" ")[0]}</em></h1>
      <p className="mt-1 text-sm text-muted-foreground">{formatInTimeZone(now, timezone, "EEEE, dd MMM yyyy")}{subtitle ? ` - ${subtitle}` : ""}</p>
    </div>
  );
}

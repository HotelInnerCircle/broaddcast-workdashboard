"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { api, ClientApiError } from "@/lib/api/client";

/**
 * Two settings that had no screen at all (A134).
 *
 * Found by walking every company setting through its layers: both were stored,
 * validated and read by the code, and reachable only by somebody writing a
 * PATCH by hand. The payroll cycle in particular decides which days land in
 * which month's pay - a company on a 26th-to-25th cycle had no way to say so
 * except through the API, which is not a way.
 */
export function PayrollAndCodes({
  payrollStartDay, employeeCodePrefix, employeeCodePadding,
}: {
  payrollStartDay: number; employeeCodePrefix: string; employeeCodePadding: number;
}) {
  const [day, setDay] = useState(String(payrollStartDay));
  const [prefix, setPrefix] = useState(employeeCodePrefix);
  const [padding, setPadding] = useState(String(employeeCodePadding));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api("/api/admin/company", {
        method: "PATCH",
        json: {
          payrollStartDay: Number(day),
          employeeCodePrefix: prefix.trim(),
          employeeCodePadding: Number(padding),
        },
      });
      toast.success("Saved");
    } catch (e) { toast.error(e instanceof ClientApiError ? e.message : "Could not save"); }
    finally { setBusy(false); }
  };

  const sample = `${prefix || "EMP"}${"1".padStart(Number(padding) || 3, "0")}`;
  const cycle = Number(day) === 1
    ? "The calendar month - 1st to the last day."
    : `The ${day}${nth(Number(day))} to the ${prevDay(Number(day))}${nth(prevDay(Number(day)))} of the next month.`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payroll cycle and employee codes</CardTitle>
        <CardDescription>
          Which days a month of pay covers, and how new employee numbers are made.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="pay-day" className="text-[13px] font-semibold">Pay month starts on</label>
            <NativeSelect id="pay-day" value={day} onChange={(e) => setDay(e.target.value)}>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d === 1 ? "1st (calendar month)" : `${d}${nth(d)}`}</option>
              ))}
            </NativeSelect>
            {/*
              Said back in words, because "26" on its own does not tell anybody
              that September's pay then runs from the 26th of August.
            */}
            <p className="mt-1 text-[11.5px] text-muted-foreground">{cycle}</p>
          </div>

          <div>
            <label htmlFor="code-prefix" className="text-[13px] font-semibold">Employee code starts with</label>
            <Input id="code-prefix" value={prefix} maxLength={8} onChange={(e) => setPrefix(e.target.value.toUpperCase())} />
          </div>

          <div>
            <label htmlFor="code-pad" className="text-[13px] font-semibold">Digits after it</label>
            <Input id="code-pad" type="number" min={1} max={8} value={padding} onChange={(e) => setPadding(e.target.value)} />
            <p className="mt-1 text-[11.5px] text-muted-foreground">Next one looks like <span className="font-mono">{sample}</span></p>
          </div>
        </div>

        <p className="rounded-xl bg-muted/50 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Changing the cycle moves which days are counted where.</strong> The
          attendance ledger follows it too, so a payslip and the days behind it never disagree - but a month
          already paid keeps the days it was paid for.
        </p>

        <div className="flex justify-end">
          <Button loading={busy} onClick={() => void save()}>Save</Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** 1st, 2nd, 3rd, 4th - the suffix people expect to read. */
function nth(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

/** A cycle starting on the 26th ends on the 25th: the day before the next one opens. */
const prevDay = (d: number) => (d <= 1 ? 31 : d - 1);

"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ExportFormat = "csv" | "xlsx" | "pdf";

/**
 * CSV / Excel / PDF for whatever report is on screen.
 *
 * The download goes through `fetch` rather than a plain link so the session
 * cookie applies and an error comes back as a message instead of a downloaded
 * file full of JSON. The server names the file in Content-Disposition; the blob
 * URL is revoked afterwards so the page does not hold the bytes.
 */
export function ExportButtons({
  href,
  formats = ["csv", "xlsx", "pdf"],
  disabled,
}: {
  /** The report endpoint with its filters already applied, minus `format`. */
  href: string;
  formats?: ExportFormat[];
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const download = async (fmt: ExportFormat) => {
    setBusy(fmt);
    try {
      const url = `${href}${href.includes("?") ? "&" : "?"}format=${fmt}`;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Export failed");
      }
      const blob = await res.blob();
      const name = res.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `report.${fmt}`;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
      toast.success(`${name} downloaded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const LABEL: Record<ExportFormat, { text: string; icon: typeof Download }> = {
    csv: { text: "CSV", icon: Download },
    xlsx: { text: "Excel", icon: FileSpreadsheet },
    pdf: { text: "PDF", icon: FileText },
  };

  return (
    <div className="flex items-center gap-1">
      {formats.map((fmt) => {
        const { text, icon: Icon } = LABEL[fmt];
        return (
          <Button key={fmt} variant="outline" size="sm" disabled={disabled} loading={busy === fmt} onClick={() => download(fmt)}>
            <Icon />
            {text}
          </Button>
        );
      })}
    </div>
  );
}

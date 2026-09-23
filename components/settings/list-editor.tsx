"use client";
import { useState } from "react";
import { Briefcase, Plus, ShoppingBag, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ClientApiError } from "@/lib/api/client";

/**
 * Editor for a company-owned list of labels (A57 designations, A69 services). Adding or removing a
 * chip saves immediately through the normal company-settings endpoint; suggestions are one tap.
 */
const ICONS = { services: ShoppingBag, designations: Briefcase } as const;

export function ListEditor({ field, initial, title, description, placeholder, suggestions }: {
  /** Company settings field this list is stored in. */
  field: "designations" | "services";
  initial: string[];
  title: string;
  description: string;
  placeholder: string;
  suggestions: string[];
}) {
  const Icon = ICONS[field];
  const [items, setItems] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (next: string[], okMsg: string) => {
    setSaving(true);
    try {
      const res = await api<Record<string, string[]>>("/api/admin/company", { method: "PATCH", json: { [field]: next } });
      setItems(res[field] ?? next);
      toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Could not save");
    } finally { setSaving(false); }
  };
  const add = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (items.some((d) => d.toLowerCase() === v.toLowerCase())) { toast.error(`"${v}" is already in the list`); return; }
    setDraft("");
    void save([...items, v], `Added "${v}"`);
  };
  const remove = (value: string) => void save(items.filter((d) => d !== value), `Removed "${value}"`);
  const unused = suggestions.filter((s) => !items.some((d) => d.toLowerCase() === s.toLowerCase())).slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon className="size-5 text-primary" />{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(draft); }}>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} maxLength={60} aria-label={`New ${field === "services" ? "service" : "designation"}`} />
          <Button type="submit" loading={saving} disabled={!draft.trim()}><Plus />Add</Button>
        </form>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing added yet. Type your own above or pick from the suggestions.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {items.map((d) => (
              <li key={d} className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft py-1 pl-3 pr-1.5 text-sm font-medium text-primary">
                {d}
                <button type="button" onClick={() => remove(d)} disabled={saving} className="rounded-full p-0.5 hover:bg-primary/15" aria-label={`Remove ${d}`}><X className="size-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        {unused.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Suggestions</p>
            <div className="flex flex-wrap gap-2">
              {unused.map((s) => (
                <button key={s} type="button" onClick={() => add(s)} disabled={saving} className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-border hover:text-foreground">+ {s}</button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

"use client";
import { useState } from "react";
import { Plus, X, Briefcase } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api, ClientApiError } from "@/lib/api/client";

const SUGGESTIONS = ["Web Developer", "Mobile Developer", "UI/UX Designer", "Graphic Designer", "Project Manager", "QA Engineer", "Business Analyst", "Content Writer", "Digital Marketer", "Accountant", "HR Executive", "Sales Executive"];

/**
 * Company job designations (A57): the admin keeps this list; it feeds the "Designation" picker
 * when adding or editing people. Saved through the normal company-settings endpoint.
 */
export function DesignationsEditor({ initial }: { initial: string[] }) {
  const [items, setItems] = useState<string[]>(initial);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (next: string[], okMsg: string) => {
    setSaving(true);
    try {
      const res = await api<{ designations: string[] }>("/api/admin/company", { method: "PATCH", json: { designations: next } });
      setItems(res.designations);
      toast.success(okMsg);
    } catch (e) {
      toast.error(e instanceof ClientApiError ? e.message : "Could not save designations");
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
  const unusedSuggestions = SUGGESTIONS.filter((s) => !items.some((d) => d.toLowerCase() === s.toLowerCase())).slice(0, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Briefcase className="size-5 text-primary" />Job designations</CardTitle>
        <CardDescription>Job titles your people can be assigned - e.g. Web Developer, Designer. They appear in the Designation dropdown when you add or edit an employee. (Access roles - Admin, Manager, Team Lead, Employee - are separate and fixed.)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(draft); }}>
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a designation, e.g. Web Developer" maxLength={60} aria-label="New designation" />
          <Button type="submit" loading={saving} disabled={!draft.trim()}><Plus />Add</Button>
        </form>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No designations yet. Add your own above or pick from the suggestions.</p>
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
        {unusedSuggestions.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Suggestions</p>
            <div className="flex flex-wrap gap-2">
              {unusedSuggestions.map((s) => (
                <button key={s} type="button" onClick={() => add(s)} disabled={saving} className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-border hover:text-foreground">+ {s}</button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

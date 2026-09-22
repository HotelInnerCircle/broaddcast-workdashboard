import { Check, Minus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/context";
import { PERMISSIONS, RESOURCES, RESOURCE_LABEL, SCOPE_LABEL } from "@/lib/permissions";
import { ROLES, ROLE_LABEL } from "@/types";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";

export const metadata = { title: "Roles" };

/** Read-only rendering of lib/permissions.ts (spec 4.5). Custom roles are out of scope for the MVP. */
export default async function RolesPage() {
  await requirePagePermission("roles", "view");
  return (
    <>
      <PageHeader title="Roles & permissions" description="Fixed roles. This matrix is the single source of truth used by both the interface and the API." />
      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR><TH className="min-w-52">Capability</TH>{ROLES.map((r) => <TH key={r} className="text-center">{ROLE_LABEL[r]}</TH>)}</TR>
            </THead>
            <TBody>
              {RESOURCES.map((res) => (
                <TR key={res}>
                  <TD className="font-medium">{RESOURCE_LABEL[res]}</TD>
                  {ROLES.map((r) => {
                    const grant = PERMISSIONS[r][res];
                    return (
                      <TD key={r} className="text-center">
                        {grant ? (
                          <div className="inline-flex flex-col items-center gap-0.5">
                            <Check className="size-4 text-success" />
                            <span className="text-[11px] text-muted-foreground">{grant.actions.join(", ")}</span>
                            {grant.scope !== "company" && <span className="rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{SCOPE_LABEL[grant.scope]}</span>}
                          </div>
                        ) : <Minus className="mx-auto size-4 text-muted-foreground/40" />}
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

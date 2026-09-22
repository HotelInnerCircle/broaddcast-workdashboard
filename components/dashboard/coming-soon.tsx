import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

/** Placeholder block for dashboard widgets that ship in a later phase. */
export function ComingSoon({ title, phase, description }: { title: string; phase: number; description: string }) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{title}<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">Phase {phase}</span></CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-24 rounded-lg bg-muted/50" />
      </CardContent>
    </Card>
  );
}

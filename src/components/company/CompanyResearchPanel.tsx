/**
 * Shared "research summary" display — pain point, hiring/tech signals,
 * recent news, and contact status. Used on both the review page
 * (app/(dashboard)/review/[id]/page.tsx) and the standalone company page
 * (app/(dashboard)/companies/[id]/page.tsx), since a researched company's
 * findings are the same regardless of whether a draft exists for it yet.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Company, Contact } from "@/types";

export function CompanyResearchPanel({ company, contact }: { company: Company; contact: Contact | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Company research</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <Field label="Pain point identified">{company.painPoint ?? "Unknown"}</Field>
        <Field label="Hiring signals">
          {company.hiringSignals.length > 0 ? company.hiringSignals.join(", ") : "None found"}
        </Field>
        <Field label="Tech signals">
          {company.techSignals.length > 0 ? company.techSignals.join(", ") : "None found"}
        </Field>
        <Field label="Recent news">{company.recentNews ?? "Unknown"}</Field>
        {contact ? (
          <Field label="Contact">
            {contact.name}
            {contact.title ? `, ${contact.title}` : ""}
            {contact.email ? ` — ${contact.email}` : ""}
            {!contact.email && " — no verified email"}
          </Field>
        ) : (
          <p className="text-amber-600">No contact found — flagged for manual entry.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}

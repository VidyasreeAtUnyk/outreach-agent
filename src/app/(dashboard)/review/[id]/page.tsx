import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mapCompanyRow, mapContactRow, mapDraftRow } from "@/lib/supabase/mappers";
import { getProjectById } from "@/lib/projects";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfidenceScore } from "@/components/review/ConfidenceScore";
import { EmailPreview } from "@/components/review/EmailPreview";
import { CompanyResearchPanel } from "@/components/company/CompanyResearchPanel";

/** Full review UI for a single draft: research context, project match, and the editable email itself. */
export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: draftRow, error: draftError } = await supabase
    .from("drafts")
    .select("*")
    .eq("id", id)
    .single();

  if (draftError || !draftRow) {
    notFound();
  }

  const draft = mapDraftRow(draftRow);

  const { data: companyRow } = await supabase
    .from("companies")
    .select("*")
    .eq("id", draft.companyId)
    .single();
  if (!companyRow) {
    notFound();
  }
  const company = mapCompanyRow(companyRow);

  const contact = draft.contactId
    ? await supabase
        .from("contacts")
        .select("*")
        .eq("id", draft.contactId)
        .single()
        .then(({ data }) => (data ? mapContactRow(data) : null))
    : null;

  const project = draft.projectMatched ? getProjectById(draft.projectMatched) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{company.name}</h1>
          {contact && (
            <span className="text-muted-foreground">
              · {contact.name}
              {contact.title ? `, ${contact.title}` : ""}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <ConfidenceScore score={draft.confidenceScore} />
          {company.industry && <Badge variant="outline">{company.industry}</Badge>}
          <Badge variant="secondary">{draft.status}</Badge>
        </div>
      </div>

      <CompanyResearchPanel company={company} contact={contact} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project matched</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {project ? (
            <>
              <Field label="Project">{project.name}</Field>
              <Field label="Why">{draft.matchReasoning ?? "No reasoning recorded."}</Field>
              <Field label="Demo">
                {project.demo ? (
                  <a href={project.demo} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    {project.demo}
                  </a>
                ) : (
                  <a href={project.github ?? "#"} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    {project.github} (no live demo)
                  </a>
                )}
              </Field>
              <Field label="Needs customisation">
                {draft.needsDemoCustomisation ? draft.customisationNotes ?? "Yes" : "No"}
              </Field>
            </>
          ) : (
            <p className="text-muted-foreground">No project match recorded for this draft.</p>
          )}
          <Field label="Confidence reasoning">{draft.confidenceReason ?? "Not scored."}</Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Draft email</CardTitle>
        </CardHeader>
        <CardContent>
          <EmailPreview draft={draft} />
        </CardContent>
      </Card>
    </div>
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

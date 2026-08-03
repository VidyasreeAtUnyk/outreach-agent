import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mapCompanyRow, mapContactRow } from "@/lib/supabase/mappers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CompanyResearchPanel } from "@/components/company/CompanyResearchPanel";
import { CompanyActions } from "@/components/company/CompanyActions";
import { RESEARCH_STATUS } from "@/lib/constants";

/** Detail view for a single company — full research if researched, or a "not yet researched" prompt for a discovered stub, plus the same contextual action (research/generate draft/view draft) as the companies list. */
export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: companyRow, error: companyError } = await supabase
    .from("companies")
    .select("*")
    .eq("id", id)
    .single();

  if (companyError || !companyRow) {
    notFound();
  }
  const company = mapCompanyRow(companyRow);

  const { data: contactRow } = await supabase
    .from("contacts")
    .select("*")
    .eq("company_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const contact = contactRow ? mapContactRow(contactRow) : null;

  const { data: latestDraftRow } = await supabase
    .from("drafts")
    .select("id, status")
    .eq("company_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestDraft = latestDraftRow as { id: string; status: string } | null;

  const isResearched = company.researchStatus === RESEARCH_STATUS.RESEARCHED;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{company.name}</h1>
          <a href={company.url} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground underline underline-offset-4">
            {company.url}
          </a>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge variant={isResearched ? "secondary" : "outline"}>{company.researchStatus}</Badge>
          {company.industry && <Badge variant="outline">{company.industry}</Badge>}
          {latestDraft && <Badge variant="secondary">{latestDraft.status}</Badge>}
        </div>
      </div>

      <div className="flex justify-end">
        <CompanyActions
          companyId={company.id}
          companyUrl={company.url}
          researchStatus={company.researchStatus}
          latestDraftId={latestDraft?.id ?? null}
        />
      </div>

      {isResearched ? (
        <CompanyResearchPanel company={company} contact={contact} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Not yet researched</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            This company was found by a discovery search but hasn&apos;t been fully researched yet. Click
            &quot;Research now&quot; above to run the full pipeline (product/hiring/funding search, synthesis, and
            contact lookup).
          </CardContent>
        </Card>
      )}
    </div>
  );
}

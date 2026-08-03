import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { mapCompanyRow } from "@/lib/supabase/mappers";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CompanyActions } from "@/components/company/CompanyActions";
import { ROUTES, RESEARCH_STATUS } from "@/lib/constants";

interface DraftSummaryRow {
  id: string;
  company_id: string;
  status: string;
}

/** Every discovered or researched company, independent of whether a draft exists yet — see docs/decisions/07-company-discovery.md. */
export default async function CompaniesPage() {
  const supabase = await createClient();

  const [companiesResult, draftsResult] = await Promise.all([
    supabase.from("companies").select("*").order("created_at", { ascending: false }),
    supabase
      .from("drafts")
      .select("id, company_id, status")
      .order("created_at", { ascending: false }),
  ]);

  const companies = (companiesResult.data ?? []).map(mapCompanyRow);
  const drafts = (draftsResult.data ?? []) as DraftSummaryRow[];

  const latestDraftByCompany = new Map<string, DraftSummaryRow>();
  for (const draft of drafts) {
    if (!latestDraftByCompany.has(draft.company_id)) {
      latestDraftByCompany.set(draft.company_id, draft);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Companies</h1>
        <p className="text-sm text-muted-foreground">
          Every company you&apos;ve discovered or researched, regardless of whether a draft exists yet.
        </p>
      </div>

      {companies.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet —{" "}
          <Link href={ROUTES.DISCOVER} className="underline underline-offset-4">
            find some companies
          </Link>{" "}
          or{" "}
          <Link href={ROUTES.RESEARCH} className="underline underline-offset-4">
            add one manually
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {companies.map((company) => {
            const latestDraft = latestDraftByCompany.get(company.id) ?? null;
            return (
              <Card key={company.id}>
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={ROUTES.COMPANY_DETAIL(company.id)} className="font-medium hover:underline">
                        {company.name}
                      </Link>
                      <Badge variant={company.researchStatus === RESEARCH_STATUS.RESEARCHED ? "secondary" : "outline"}>
                        {company.researchStatus}
                      </Badge>
                      {company.industry && <Badge variant="outline">{company.industry}</Badge>}
                      {latestDraft && <Badge variant="secondary">{latestDraft.status}</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{company.painPoint ?? company.url}</p>
                  </div>
                  <CompanyActions
                    companyId={company.id}
                    companyUrl={company.url}
                    researchStatus={company.researchStatus}
                    latestDraftId={latestDraft?.id ?? null}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

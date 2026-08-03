import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { mapDraftRow, mapCompanyRow } from "@/lib/supabase/mappers";
import { getOpenAiUsage } from "@/lib/integrations/openai";
import { getTavilyUsage } from "@/lib/integrations/tavily";
import { getApolloUsage } from "@/lib/integrations/apollo";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DRAFT_STATUS, RESEARCH_STATUS, ROUTES } from "@/lib/constants";

const COLD_LEAD_THRESHOLD_DAYS = 3;
/** Below this many remaining units, a usage card switches from informational to a warning/critical color. */
const LOW_BUDGET_WARNING_THRESHOLD_RATIO = 0.2;
const LOW_BUDGET_CRITICAL_THRESHOLD_RATIO = 0.05;

/** Dashboard: aggregate stats, quick actions, recent activity, and drafts that have gone cold in review. */
export default async function DashboardPage() {
  const supabase = await createClient();

  const [companiesResult, draftsResult, repliesResult, openAiUsage, tavilyUsage, apolloUsage] = await Promise.all([
    supabase.from("companies").select("*").order("created_at", { ascending: false }),
    supabase.from("drafts").select("*").order("created_at", { ascending: false }),
    supabase.from("replies").select("id", { count: "exact", head: true }),
    getOpenAiUsage(supabase),
    getTavilyUsage(supabase),
    getApolloUsage(supabase),
  ]);

  const companies = (companiesResult.data ?? []).map(mapCompanyRow);
  const drafts = (draftsResult.data ?? []).map(mapDraftRow);
  const repliesCount = repliesResult.count ?? 0;

  const researchedCompanies = companies.filter((c) => c.researchStatus === RESEARCH_STATUS.RESEARCHED);
  const discoveredCompanies = companies.filter((c) => c.researchStatus === RESEARCH_STATUS.DISCOVERED);

  const pendingDrafts = drafts.filter((d) => d.status === DRAFT_STATUS.PENDING);
  const sentDrafts = drafts.filter((d) => d.status === DRAFT_STATUS.SENT);

  const coldThreshold = new Date();
  coldThreshold.setDate(coldThreshold.getDate() - COLD_LEAD_THRESHOLD_DAYS);
  const coldDrafts = pendingDrafts.filter((d) => new Date(d.createdAt) < coldThreshold);

  const companiesById = new Map(companies.map((c) => [c.id, c]));
  const recentDrafts = drafts.slice(0, 8);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {researchedCompanies.length} companies researched
          {discoveredCompanies.length > 0 && ` (+${discoveredCompanies.length} discovered, not yet researched)`} ·{" "}
          {pendingDrafts.length} pending review · {sentDrafts.length} sent · {repliesCount} replies
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <UsageCard
          label="OpenAI call budget"
          note="Each research or regenerate spends 1 call, each logged reply spends 1 call. Never resets."
          used={openAiUsage.callsUsed}
          budget={openAiUsage.callBudget}
          remaining={openAiUsage.remaining}
        />
        <UsageCard
          label="Tavily search credits (this month)"
          note="Each research spends up to 3 credits (product, hiring, funding searches). Resets monthly."
          used={tavilyUsage.creditsUsed}
          budget={tavilyUsage.creditBudget}
          remaining={tavilyUsage.remaining}
        />
        <UsageCard
          label="Apollo credits (this cycle)"
          note="Each contact lookup spends 1 credit when Apollo is tried. Resets each cycle."
          used={apolloUsage.creditsUsed}
          budget={apolloUsage.creditBudget}
          remaining={apolloUsage.remaining}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Researched" value={researchedCompanies.length} />
        <StatCard label="Discovered" value={discoveredCompanies.length} />
        <StatCard label="Pending review" value={pendingDrafts.length} />
        <StatCard label="Sent" value={sentDrafts.length} />
        <StatCard label="Replies" value={repliesCount} />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href={ROUTES.DISCOVER}>Discover companies</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={ROUTES.RESEARCH}>Research a company</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={ROUTES.COMPANIES}>Browse companies</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={ROUTES.REVIEW}>Go to review queue</Link>
        </Button>
      </div>

      {coldDrafts.length > 0 && (
        <Card className="border-amber-500/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Badge variant="warning">Cold</Badge>
              {coldDrafts.length} draft{coldDrafts.length === 1 ? "" : "s"} sitting in review for{" "}
              {COLD_LEAD_THRESHOLD_DAYS}+ days
            </CardTitle>
            <CardDescription>These drafts may be worth reviewing before the research goes stale.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {coldDrafts.map((draft) => (
              <Link
                key={draft.id}
                href={ROUTES.REVIEW_DETAIL(draft.id)}
                className="text-sm underline underline-offset-4"
              >
                {companiesById.get(draft.companyId)?.name ?? "Unknown company"} — {draft.subject}
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentDrafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet — <Link href={ROUTES.RESEARCH} className="underline underline-offset-4">research your first company</Link>.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {recentDrafts.map((draft) => (
                <li key={draft.id} className="flex items-center justify-between text-sm">
                  <Link href={ROUTES.REVIEW_DETAIL(draft.id)} className="hover:underline">
                    {companiesById.get(draft.companyId)?.name ?? "Unknown company"} — {draft.subject}
                  </Link>
                  <Badge variant="secondary">{draft.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-2xl font-semibold">{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

/** A remaining-budget card shared by the OpenAI and Tavily usage displays — color shifts from neutral to warning to critical as the remaining share shrinks. */
function UsageCard({
  label,
  note,
  used,
  budget,
  remaining,
}: {
  label: string;
  note: string;
  used: number;
  budget: number;
  remaining: number;
}) {
  const remainingRatio = budget > 0 ? remaining / budget : 1;
  const isCritical = remainingRatio <= LOW_BUDGET_CRITICAL_THRESHOLD_RATIO;
  const isWarning = remainingRatio <= LOW_BUDGET_WARNING_THRESHOLD_RATIO;

  return (
    <Card className={isCritical ? "border-destructive/50" : isWarning ? "border-amber-500/50" : undefined}>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-sm text-muted-foreground">
            {used} of {budget} used — {note}
          </p>
        </div>
        <Badge variant={isCritical ? "destructive" : isWarning ? "warning" : "secondary"}>
          {remaining} remaining
        </Badge>
      </CardContent>
    </Card>
  );
}

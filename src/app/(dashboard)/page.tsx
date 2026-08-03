import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { mapDraftRow, mapCompanyRow } from "@/lib/supabase/mappers";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DRAFT_STATUS, ROUTES } from "@/lib/constants";

const COLD_LEAD_THRESHOLD_DAYS = 3;

/** Dashboard: aggregate stats, quick actions, recent activity, and drafts that have gone cold in review. */
export default async function DashboardPage() {
  const supabase = await createClient();

  const [companiesResult, draftsResult, repliesResult] = await Promise.all([
    supabase.from("companies").select("*").order("created_at", { ascending: false }),
    supabase.from("drafts").select("*").order("created_at", { ascending: false }),
    supabase.from("replies").select("id", { count: "exact", head: true }),
  ]);

  const companies = (companiesResult.data ?? []).map(mapCompanyRow);
  const drafts = (draftsResult.data ?? []).map(mapDraftRow);
  const repliesCount = repliesResult.count ?? 0;

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
          {companies.length} companies researched · {pendingDrafts.length} pending review ·{" "}
          {sentDrafts.length} sent · {repliesCount} replies
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Researched" value={companies.length} />
        <StatCard label="Pending review" value={pendingDrafts.length} />
        <StatCard label="Sent" value={sentDrafts.length} />
        <StatCard label="Replies" value={repliesCount} />
      </div>

      <div className="flex gap-3">
        <Button asChild>
          <Link href={ROUTES.RESEARCH}>Research new company</Link>
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

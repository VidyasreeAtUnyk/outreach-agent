/**
 * One row in the review queue: company, contact, confidence, matched
 * project, and creation date, linking through to the full review page.
 */
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ConfidenceScore } from "@/components/review/ConfidenceScore";
import { ROUTES } from "@/lib/constants";
import type { DraftWithRelations } from "@/types";

export function DraftCard({ draft }: { draft: DraftWithRelations }) {
  return (
    <Link href={ROUTES.REVIEW_DETAIL(draft.id)}>
      <Card className="transition-colors hover:bg-accent/50">
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{draft.company.name}</span>
              {draft.contact && (
                <span className="text-sm text-muted-foreground">
                  · {draft.contact.name}
                  {draft.contact.title ? `, ${draft.contact.title}` : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {draft.projectMatched && <span>{draft.projectMatched}</span>}
              <span>·</span>
              <span>{new Date(draft.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="secondary">{draft.status}</Badge>
            <ConfidenceScore score={draft.confidenceScore} />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

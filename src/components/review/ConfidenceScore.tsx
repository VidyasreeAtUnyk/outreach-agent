/**
 * Renders a draft's 1-10 confidence score as a color-coded badge matching
 * the send/review/skip recommendation bands (see lib/agent/score.ts).
 */
import { Badge } from "@/components/ui/badge";
import { SCORE_THRESHOLDS } from "@/lib/constants";

export function ConfidenceScore({ score }: { score: number | null }) {
  if (score === null) {
    return <Badge variant="outline">Not scored</Badge>;
  }

  const variant =
    score >= SCORE_THRESHOLDS.SEND_MIN
      ? "success"
      : score >= SCORE_THRESHOLDS.REVIEW_MIN
        ? "warning"
        : "destructive";

  return (
    <Badge variant={variant}>
      {score}/10
    </Badge>
  );
}

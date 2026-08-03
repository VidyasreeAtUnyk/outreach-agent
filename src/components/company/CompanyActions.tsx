"use client";

/**
 * The action available for a company row/detail view depends entirely on
 * its state: a 'discovered' stub can only be researched; a 'researched'
 * company with no draft yet can have one generated; a company with an
 * existing draft just links to it. Shared between the companies list
 * (app/(dashboard)/companies/page.tsx) and detail
 * (app/(dashboard)/companies/[id]/page.tsx) pages so this branching logic
 * — and its error handling for a mid-run budget exhaustion — lives once.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ROUTES, RESEARCH_STATUS } from "@/lib/constants";
import type { ResearchStatus } from "@/types";

interface ResearchResponse {
  draftId: string | null;
  draftError: string | null;
}

interface DraftResponse {
  draftId: string;
}

export function CompanyActions({
  companyId,
  companyUrl,
  researchStatus,
  latestDraftId,
}: {
  companyId: string;
  companyUrl: string;
  researchStatus: ResearchStatus;
  latestDraftId: string | null;
}) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResearch() {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyUrl }),
      });
      const json: unknown = await response.json();

      if (!response.ok) {
        setError((json as { error?: string }).error ?? "Research failed.");
        setIsSubmitting(false);
        return;
      }

      const result = json as ResearchResponse;
      if (result.draftId) {
        router.push(ROUTES.REVIEW_DETAIL(result.draftId));
        return;
      }
      if (result.draftError) {
        setError(`Researched successfully, but drafting failed: ${result.draftError}`);
      }
      setIsSubmitting(false);
      router.refresh();
    } catch {
      setError("Research failed — check your connection and try again.");
      setIsSubmitting(false);
    }
  }

  async function handleGenerateDraft() {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const json: unknown = await response.json();

      if (!response.ok) {
        setError((json as { error?: string }).error ?? "Draft generation failed.");
        setIsSubmitting(false);
        return;
      }

      const result = json as DraftResponse;
      router.push(ROUTES.REVIEW_DETAIL(result.draftId));
    } catch {
      setError("Draft generation failed — check your connection and try again.");
      setIsSubmitting(false);
    }
  }

  if (latestDraftId) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={ROUTES.REVIEW_DETAIL(latestDraftId)}>View draft</Link>
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {researchStatus === RESEARCH_STATUS.DISCOVERED ? (
        <Button size="sm" onClick={handleResearch} disabled={isSubmitting}>
          {isSubmitting ? "Researching…" : "Research now"}
        </Button>
      ) : (
        <Button size="sm" onClick={handleGenerateDraft} disabled={isSubmitting}>
          {isSubmitting ? "Drafting…" : "Generate draft"}
        </Button>
      )}
      {error && <p className="max-w-xs text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}

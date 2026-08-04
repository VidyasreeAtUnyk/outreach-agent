"use client";

/**
 * Submits a natural-language description to POST /api/discover, which runs
 * one Tavily search plus exactly one OpenAI call to extract a list of
 * candidate companies with a relevance score each (see lib/agent/discover.ts
 * and docs/decisions/07-company-discovery.md). Candidates are persisted as
 * 'discovered' company stubs immediately, sorted by score descending.
 *
 * "Process all" drives an automated batch run entirely from this component:
 * a client-side loop calls POST /api/batch/process-company once per
 * candidate, in score order, awaiting each before starting the next — see
 * docs/decisions/09-automated-batch-runs.md for why this is a client-driven
 * loop rather than a background job (no new infrastructure, and progress is
 * inherently live since this component *is* the loop). On any per-company
 * failure, that company is marked errored and the loop moves on to the
 * next one rather than aborting the run.
 */
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/lib/constants";
import type { DiscoveredCompany, ScoreResult } from "@/types";

interface DiscoverResponse {
  discovered: DiscoveredCompany[];
  incompleteSteps: string[];
}

interface BatchProcessResponse {
  companyId: string;
  researched: boolean;
  researchError: string | null;
  score: ScoreResult | null;
  scoreError: string | null;
  skippedDraft: boolean;
  drafted: boolean;
  draftId: string | null;
  draftError: string | null;
}

type BatchItemStatus =
  | { state: "queued" }
  | { state: "processing" }
  | { state: "drafted"; draftId: string; score: number }
  | { state: "skipped"; score: number; reason: string }
  | { state: "errored"; message: string };

export function DiscoverForm() {
  const [query, setQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiscoverResponse | null>(null);
  const [statuses, setStatuses] = useState<Record<string, BatchItemStatus>>({});
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const stopRequestedRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setStatuses({});
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const json: unknown = await response.json();

      if (!response.ok) {
        setError((json as { error?: string }).error ?? "Discovery failed.");
        setIsSubmitting(false);
        return;
      }

      const discoverResult = json as DiscoverResponse;
      setResult(discoverResult);
      setStatuses(Object.fromEntries(discoverResult.discovered.map((c) => [c.id, { state: "queued" as const }])));
      setIsSubmitting(false);
    } catch {
      setError("Discovery failed — check your connection and try again.");
      setIsSubmitting(false);
    }
  }

  async function processOne(companyId: string): Promise<void> {
    setStatuses((prev) => ({ ...prev, [companyId]: { state: "processing" } }));

    try {
      const response = await fetch("/api/batch/process-company", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      });
      const json: unknown = await response.json();

      if (!response.ok) {
        setStatuses((prev) => ({
          ...prev,
          [companyId]: { state: "errored", message: (json as { error?: string }).error ?? "Failed." },
        }));
        return;
      }

      const batchResult = json as BatchProcessResponse;

      if (batchResult.drafted && batchResult.draftId) {
        setStatuses((prev) => ({
          ...prev,
          [companyId]: { state: "drafted", draftId: batchResult.draftId!, score: batchResult.score?.score ?? 0 },
        }));
      } else if (batchResult.skippedDraft) {
        setStatuses((prev) => ({
          ...prev,
          [companyId]: {
            state: "skipped",
            score: batchResult.score?.score ?? 0,
            reason: batchResult.score?.reasoning ?? "Low confidence match.",
          },
        }));
      } else {
        const message = batchResult.researchError ?? batchResult.scoreError ?? batchResult.draftError ?? "Failed.";
        setStatuses((prev) => ({ ...prev, [companyId]: { state: "errored", message } }));
      }
    } catch {
      setStatuses((prev) => ({ ...prev, [companyId]: { state: "errored", message: "Network error." } }));
    }
  }

  async function handleProcessAll() {
    if (!result) return;
    stopRequestedRef.current = false;
    setIsBatchRunning(true);

    for (const candidate of result.discovered) {
      if (stopRequestedRef.current) break;
      // eslint-disable-next-line no-await-in-loop -- intentionally sequential: each company is processed only after the previous one finishes, so progress is meaningfully ordered and live
      await processOne(candidate.id);
    }

    setIsBatchRunning(false);
  }

  function handleStop() {
    stopRequestedRef.current = true;
  }

  const counts = result
    ? result.discovered.reduce(
        (acc, c) => {
          const status = statuses[c.id]?.state ?? "queued";
          acc[status] = (acc[status] ?? 0) + 1;
          return acc;
        },
        {} as Record<BatchItemStatus["state"], number>,
      )
    : null;

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex max-w-lg flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="query">What kind of company are you looking for?</Label>
          <Input
            id="query"
            required
            minLength={3}
            maxLength={200}
            placeholder="AI agent companies with UAE presence"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={isSubmitting}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Searching…" : "Find companies"}
        </Button>
      </form>

      {result && (
        <div className="flex flex-col gap-3">
          {result.incompleteSteps.length > 0 && (
            <p className="text-sm text-amber-600">
              Search returned thin results — try a more specific description if this list looks short.
            </p>
          )}
          {result.discovered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No confident matches found. Try a more specific or differently-worded description.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {counts &&
                    `Processed ${(counts.drafted ?? 0) + (counts.skipped ?? 0) + (counts.errored ?? 0)}/${result.discovered.length} — ${counts.drafted ?? 0} drafted, ${counts.skipped ?? 0} skipped (low confidence), ${counts.errored ?? 0} errored`}
                </p>
                {isBatchRunning ? (
                  <Button variant="outline" size="sm" onClick={handleStop}>
                    Stop after current company
                  </Button>
                ) : (
                  <Button size="sm" onClick={handleProcessAll}>
                    Process all (research → score → draft, in order)
                  </Button>
                )}
              </div>

              {result.discovered.map((candidate) => {
                const status = statuses[candidate.id] ?? { state: "queued" as const };
                return (
                  <Card key={candidate.id}>
                    <CardContent className="flex items-center justify-between gap-4 py-4">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{candidate.name}</span>
                          <Badge variant="outline">relevance {candidate.score}/10</Badge>
                          {candidate.alreadyKnown && <Badge variant="secondary">already known</Badge>}
                          <StatusBadge status={status} />
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {status.state === "errored"
                            ? status.message
                            : status.state === "skipped"
                              ? status.reason
                              : candidate.reason}
                        </p>
                        <a
                          href={candidate.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm underline underline-offset-4"
                        >
                          {candidate.url}
                        </a>
                      </div>
                      <Button asChild size="sm" variant="outline">
                        <Link
                          href={
                            status.state === "drafted"
                              ? ROUTES.REVIEW_DETAIL(status.draftId)
                              : ROUTES.COMPANY_DETAIL(candidate.id)
                          }
                        >
                          View
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: BatchItemStatus }) {
  switch (status.state) {
    case "processing":
      return <Badge variant="secondary">processing…</Badge>;
    case "drafted":
      return <Badge variant="success">drafted · {status.score}/10</Badge>;
    case "skipped":
      return <Badge variant="warning">skipped · {status.score}/10</Badge>;
    case "errored":
      return <Badge variant="destructive">errored</Badge>;
    default:
      return null;
  }
}

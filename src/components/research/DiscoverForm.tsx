"use client";

/**
 * Submits a natural-language description to POST /api/discover, which runs
 * one Tavily search plus exactly one OpenAI call to extract a list of
 * candidate companies (see lib/agent/discover.ts and
 * docs/decisions/07-company-discovery.md). Candidates are persisted as
 * 'discovered' company stubs immediately, so this form only needs to
 * display the result of the run just made — anything discovered is also
 * always browsable later from /companies even if this page is never
 * revisited.
 */
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/lib/constants";
import type { DiscoveredCompany } from "@/types";

interface DiscoverResponse {
  discovered: DiscoveredCompany[];
  incompleteSteps: string[];
}

export function DiscoverForm() {
  const [query, setQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DiscoverResponse | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
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

      setResult(json as DiscoverResponse);
      setIsSubmitting(false);
    } catch {
      setError("Discovery failed — check your connection and try again.");
      setIsSubmitting(false);
    }
  }

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
            result.discovered.map((candidate) => (
              <Card key={candidate.id}>
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{candidate.name}</span>
                      {candidate.alreadyKnown && <Badge variant="secondary">already known</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground">{candidate.reason}</p>
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
                    <Link href={ROUTES.COMPANY_DETAIL(candidate.id)}>View</Link>
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}

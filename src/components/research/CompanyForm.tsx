"use client";

/**
 * Submits a company URL (plus optional contact/role details) to
 * POST /api/research, which runs the full research + draft pipeline
 * synchronously. Since that single request can take on the order of tens
 * of seconds (multiple sequential API calls), this shows a cycling staged
 * progress message instead of a plain spinner — a genuinely real-time
 * progress bar would require restructuring /api/research as a streaming
 * (SSE) endpoint, which isn't justified yet for a tool researching a
 * handful of companies a day. See docs/prompts.md Phase — UI for this
 * trade-off.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/lib/constants";

const PROGRESS_MESSAGES = [
  "Searching for product and feature signals…",
  "Reading the company's homepage…",
  "Searching for hiring signals…",
  "Searching for recent funding news…",
  "Synthesizing research with GPT-4o…",
  "Looking up a contact email…",
  "Matching to the strongest portfolio project…",
  "Drafting the email and scoring confidence…",
] as const;

interface ResearchResponse {
  draftId: string;
  companyId: string;
  contactId: string | null;
  incompleteSteps: string[];
}

export function CompanyForm() {
  const router = useRouter();
  const [companyUrl, setCompanyUrl] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [role, setRole] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isSubmitting) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      setProgressIndex((i) => Math.min(i + 1, PROGRESS_MESSAGES.length - 1));
    }, 2500);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isSubmitting]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setProgressIndex(0);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyUrl,
          contactName: contactName || undefined,
          contactTitle: contactTitle || undefined,
          role: role || undefined,
        }),
      });

      const json: unknown = await response.json();

      if (!response.ok) {
        const message = (json as { error?: string }).error ?? "Research failed.";
        setError(message);
        setIsSubmitting(false);
        return;
      }

      const result = json as ResearchResponse;
      router.push(ROUTES.REVIEW_DETAIL(result.draftId));
    } catch {
      setError("Research failed — check your connection and try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-lg">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="companyUrl">Company URL</Label>
        <Input
          id="companyUrl"
          type="url"
          required
          placeholder="https://www.bayut.com"
          value={companyUrl}
          onChange={(e) => setCompanyUrl(e.target.value)}
          disabled={isSubmitting}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contactName">Contact name (optional)</Label>
        <Input
          id="contactName"
          placeholder="Haider Ali Khan"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          disabled={isSubmitting}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contactTitle">Contact title (optional)</Label>
        <Input
          id="contactTitle"
          placeholder="CEO"
          value={contactTitle}
          onChange={(e) => setContactTitle(e.target.value)}
          disabled={isSubmitting}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="role">Role you&apos;re applying for (optional)</Label>
        <Input
          id="role"
          placeholder="Senior AI Engineer"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Researching…" : "Research company"}
      </Button>

      {isSubmitting && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {PROGRESS_MESSAGES[progressIndex]}
        </p>
      )}
    </form>
  );
}

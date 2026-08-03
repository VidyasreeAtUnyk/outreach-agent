"use client";

/**
 * The editable draft email panel plus the approve/reject actions. Subject
 * and body are editable inline; approving with edits marks the draft
 * 'edited' rather than 'approved' (see app/api/outreach/approve/route.ts).
 * Nothing here ever sends an email — see docs/decisions/01-human-in-the-loop.md.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { EMAIL_CONSTRAINTS, ROUTES } from "@/lib/constants";
import type { Draft } from "@/types";

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function EmailPreview({ draft }: { draft: Draft }) {
  const router = useRouter();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedWhat, setCopiedWhat] = useState<"subject" | "email" | null>(null);

  const wordCount = countWords(body);
  const wasEdited = subject !== draft.subject || body !== draft.body;
  const isFinal = draft.status === "approved" || draft.status === "edited" || draft.status === "rejected" || draft.status === "sent";

  async function callOutreachRoute(path: string, extraBody: Record<string, unknown> = {}) {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, ...extraBody }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        setError((json as { error?: string }).error ?? "Something went wrong.");
        setIsSubmitting(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Request failed — check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleApprove() {
    if (wasEdited) {
      await callOutreachRoute("/api/outreach/approve", { subject, body });
    } else {
      await callOutreachRoute("/api/outreach/approve");
    }
  }

  async function handleReject() {
    await callOutreachRoute("/api/outreach/reject");
    router.push(ROUTES.REVIEW);
  }

  async function copyToClipboard(text: string, what: "subject" | "email") {
    await navigator.clipboard.writeText(text);
    setCopiedWhat(what);
    setTimeout(() => setCopiedWhat(null), 2000);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="subject">Subject</Label>
        <Input
          id="subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={isFinal}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="body">Body</Label>
          <span
            className={
              wordCount > EMAIL_CONSTRAINTS.MAX_WORD_COUNT ? "text-sm text-destructive" : "text-sm text-muted-foreground"
            }
          >
            {wordCount} / {EMAIL_CONSTRAINTS.MAX_WORD_COUNT} words
          </span>
        </div>
        <Textarea
          id="body"
          rows={12}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={isFinal}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => copyToClipboard(subject, "subject")}>
          {copiedWhat === "subject" ? "Copied!" : "Copy subject"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => copyToClipboard(`Subject: ${subject}\n\n${body}`, "email")}
        >
          {copiedWhat === "email" ? "Copied!" : "Copy email"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!isFinal && (
        <div className="flex gap-2">
          <Button variant="destructive" onClick={handleReject} disabled={isSubmitting}>
            Reject
          </Button>
          <Button onClick={handleApprove} disabled={isSubmitting}>
            {wasEdited ? "Edit & Approve" : "Approve"}
          </Button>
        </div>
      )}

      {isFinal && (
        <p className="text-sm text-muted-foreground">
          This draft is <span className="font-medium">{draft.status}</span>
          {draft.status !== "rejected" && draft.status !== "sent"
            ? " — copy it above and send it from Gmail, then mark it sent from the tracker."
            : "."}
        </p>
      )}
    </div>
  );
}

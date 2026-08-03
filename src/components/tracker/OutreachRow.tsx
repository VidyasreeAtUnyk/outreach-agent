"use client";

/**
 * One row in the tracker: a sent (or approved-but-not-yet-sent) outreach,
 * with actions to mark it sent and to log a reply. Logging a reply calls
 * OpenAI for a suggested response, which is shown for the human to read
 * and send manually — nothing here sends anything either.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { DraftWithRelations, Reply } from "@/types";
import { DRAFT_STATUS } from "@/lib/constants";

export function OutreachRow({
  draft,
  latestReply,
}: {
  draft: DraftWithRelations;
  latestReply: Reply | null;
}) {
  const router = useRouter();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [suggestedResponse, setSuggestedResponse] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canMarkSent = draft.status === DRAFT_STATUS.APPROVED || draft.status === DRAFT_STATUS.EDITED;

  async function handleMarkSent() {
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/tracker/mark-sent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id }),
      });
      if (response.ok) {
        router.refresh();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogReply() {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/tracker/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, replyBody }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        setError((json as { error?: string }).error ?? "Failed to log reply.");
        return;
      }
      setSuggestedResponse((json as { suggestedResponse: string }).suggestedResponse);
      router.refresh();
    } catch {
      setError("Request failed — check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 py-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{draft.company.name}</span>
            {draft.contact && <span className="text-sm text-muted-foreground">· {draft.contact.name}</span>}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{draft.sentAt ? `Sent ${new Date(draft.sentAt).toLocaleDateString()}` : "Not sent yet"}</span>
            {latestReply && <span>· Reply: {latestReply.sentiment ?? "unclassified"}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{draft.status}</Badge>
          {canMarkSent && (
            <Button size="sm" onClick={handleMarkSent} disabled={isSubmitting}>
              Mark sent
            </Button>
          )}
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <Button size="sm" variant="outline" onClick={() => setIsDialogOpen(true)}>
              Log reply
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Log a reply from {draft.company.name}</DialogTitle>
              </DialogHeader>
              <Textarea
                rows={6}
                placeholder="Paste their reply here…"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              {suggestedResponse && (
                <div className="rounded-md border bg-muted p-3 text-sm">
                  <p className="mb-1 font-medium">Suggested response (review before sending):</p>
                  <p className="whitespace-pre-wrap">{suggestedResponse}</p>
                </div>
              )}
              <DialogFooter>
                <Button onClick={handleLogReply} disabled={isSubmitting || !replyBody.trim()}>
                  {isSubmitting ? "Analyzing…" : "Log reply & suggest response"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}

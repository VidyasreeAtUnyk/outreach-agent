/**
 * POST /api/tracker/reply
 * Logs a reply received on a sent draft and drafts a suggested response for
 * the human to review. The suggested response is never sent automatically —
 * it's returned for the human to read, edit, and send manually, same as
 * every other AI-generated text in this app.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWithinRateLimit, toErrorResponse, ApiError } from "@/lib/api-utils";
import { runJsonCompletion } from "@/lib/integrations/openai";
import { PROMPTS } from "@/lib/prompts";
import { SENTIMENT } from "@/lib/constants";

const requestSchema = z.object({
  draftId: z.string().uuid("draftId must be a valid UUID"),
  replyBody: z.string().min(1, "replyBody is required"),
});

const replyResponseSchema = z.object({
  sentiment: z.enum([SENTIMENT.POSITIVE, SENTIMENT.NEUTRAL, SENTIMENT.NEGATIVE]),
  suggestedResponse: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    requireWithinRateLimit(user.id);

    const requestBody: unknown = await request.json();
    const parsed = requestSchema.safeParse(requestBody);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { draftId, replyBody } = parsed.data;

    const { data: draftRow, error: draftError } = await supabase
      .from("drafts")
      .select("id, subject, body, company_id")
      .eq("id", draftId)
      .single();

    if (draftError || !draftRow) {
      throw new ApiError(404, "Draft not found.");
    }

    const analysis = await runJsonCompletion({
      systemPrompt: PROMPTS.REPLY_RESPONSE,
      userContent: JSON.stringify({
        originalEmail: { subject: draftRow.subject, body: draftRow.body },
        reply: replyBody,
      }),
      schema: replyResponseSchema,
      label: "reply-response",
    });

    const { data: replyRow, error: replyError } = await supabase
      .from("replies")
      .insert({
        user_id: user.id,
        draft_id: draftId,
        body: replyBody,
        received_at: new Date().toISOString(),
        sentiment: analysis.sentiment,
        suggested_response: analysis.suggestedResponse,
      })
      .select("id")
      .single();

    if (replyError || !replyRow) {
      throw new ApiError(500, `Failed to save reply: ${replyError?.message ?? "unknown error"}`);
    }

    return NextResponse.json({
      replyId: replyRow.id,
      sentiment: analysis.sentiment,
      suggestedResponse: analysis.suggestedResponse,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

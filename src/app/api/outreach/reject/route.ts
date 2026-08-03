/**
 * POST /api/outreach/reject
 * Marks a draft as rejected — the human decided not to send it (e.g. the
 * confidence score's "skip" recommendation, or a bad research match). The
 * optional reason is logged for the build/decision record but not
 * persisted on the draft row, since the schema doesn't carry a rejection-
 * reason column and this is a single-user tool with no review queue to
 * report reasons back to.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, toErrorResponse, ApiError } from "@/lib/api-utils";
import { DRAFT_STATUS } from "@/lib/constants";
import { logger } from "@/lib/logger";

const requestSchema = z.object({
  draftId: z.string().uuid("draftId must be a valid UUID"),
  reason: z.string().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();

    const requestBody: unknown = await request.json();
    const parsed = requestSchema.safeParse(requestBody);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { draftId, reason } = parsed.data;

    const { data: updatedRow, error } = await supabase
      .from("drafts")
      .update({ status: DRAFT_STATUS.REJECTED })
      .eq("id", draftId)
      .eq("user_id", user.id)
      .select("id, status")
      .single();

    if (error || !updatedRow) {
      throw new ApiError(404, "Draft not found.");
    }

    logger.info("draft rejected", { draftId, reason: reason ?? null });

    return NextResponse.json({ draftId: updatedRow.id, status: updatedRow.status });
  } catch (error) {
    return toErrorResponse(error);
  }
}

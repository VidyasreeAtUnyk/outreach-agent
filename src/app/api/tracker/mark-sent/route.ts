/**
 * POST /api/tracker/mark-sent
 * Marks an approved draft as sent, after the human has copied it and sent
 * it manually from Gmail (see docs/decisions/04-review-before-send.md).
 * This is the only place drafts.status is ever set to 'sent'.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, toErrorResponse, ApiError } from "@/lib/api-utils";
import { DRAFT_STATUS } from "@/lib/constants";

const requestSchema = z.object({
  draftId: z.string().uuid("draftId must be a valid UUID"),
});

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();

    const requestBody: unknown = await request.json();
    const parsed = requestSchema.safeParse(requestBody);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { draftId } = parsed.data;

    const { data: updatedRow, error } = await supabase
      .from("drafts")
      .update({ status: DRAFT_STATUS.SENT, sent_at: new Date().toISOString() })
      .eq("id", draftId)
      .eq("user_id", user.id)
      .in("status", [DRAFT_STATUS.APPROVED, DRAFT_STATUS.EDITED])
      .select("id, status")
      .single();

    if (error || !updatedRow) {
      throw new ApiError(404, "Approved draft not found (it must be approved or edited before it can be marked sent).");
    }

    return NextResponse.json({ draftId: updatedRow.id, status: updatedRow.status });
  } catch (error) {
    return toErrorResponse(error);
  }
}

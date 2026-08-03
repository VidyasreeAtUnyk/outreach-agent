/**
 * POST /api/outreach/approve
 * Marks a draft as ready to send. Never sends anything — see
 * docs/decisions/01-human-in-the-loop.md and
 * docs/decisions/04-review-before-send.md. If an edited subject/body is
 * supplied, it's saved and the draft is marked 'edited' rather than
 * 'approved', so the tracker can distinguish "sent as generated" from
 * "sent after human changes."
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, toErrorResponse, ApiError } from "@/lib/api-utils";
import { DRAFT_STATUS } from "@/lib/constants";

const requestSchema = z.object({
  draftId: z.string().uuid("draftId must be a valid UUID"),
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();

    const requestBody: unknown = await request.json();
    const parsed = requestSchema.safeParse(requestBody);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }
    const { draftId, subject, body } = parsed.data;

    const wasEdited = subject !== undefined || body !== undefined;

    const { data: updatedRow, error } = await supabase
      .from("drafts")
      .update({
        ...(subject !== undefined ? { subject } : {}),
        ...(body !== undefined ? { body } : {}),
        status: wasEdited ? DRAFT_STATUS.EDITED : DRAFT_STATUS.APPROVED,
        approved_at: new Date().toISOString(),
      })
      .eq("id", draftId)
      .eq("user_id", user.id)
      .select("id, status")
      .single();

    if (error || !updatedRow) {
      throw new ApiError(404, "Draft not found.");
    }

    return NextResponse.json({ draftId: updatedRow.id, status: updatedRow.status });
  } catch (error) {
    return toErrorResponse(error);
  }
}

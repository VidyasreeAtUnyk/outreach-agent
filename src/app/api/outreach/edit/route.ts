/**
 * POST /api/outreach/edit
 * Saves an in-progress edit to a draft's subject/body without approving or
 * rejecting it — used by the review page's textarea auto-save so work
 * isn't lost if the reviewer navigates away before clicking Approve.
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

    if (subject === undefined && body === undefined) {
      throw new ApiError(400, "At least one of subject or body must be provided.");
    }

    const { data: updatedRow, error } = await supabase
      .from("drafts")
      .update({
        ...(subject !== undefined ? { subject } : {}),
        ...(body !== undefined ? { body } : {}),
        status: DRAFT_STATUS.EDITED,
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

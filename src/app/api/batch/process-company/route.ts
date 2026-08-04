/**
 * POST /api/batch/process-company
 * Processes a single company through research → confidence scoring →
 * (conditionally) drafting, for the client-driven batch runner on
 * /discover — see docs/decisions/09-automated-batch-runs.md. Always
 * returns 200 with a per-phase status object; expected failures (research,
 * scoring, or drafting each failing independently) are reported as fields
 * on the response, not thrown, so the batch loop can always move on to
 * the next company.
 *
 * Deliberately NOT behind lib/ratelimit.ts's shared 10-requests/hour
 * guard: that limiter is a single bucket per user shared across every
 * AI-calling route, sized for occasional manual actions — a single
 * discovery run can surface up to 15 candidates, and this route is
 * designed to be called once per candidate in a tight, intentional
 * sequence, not a runaway loop. The real cost backstop here is the
 * per-call OpenAI budget check inside runJsonCompletion (a hard,
 * atomically-enforced cap), which every phase of processCompanyForBatch
 * already goes through.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, toErrorResponse, ApiError } from "@/lib/api-utils";
import { processCompanyForBatch } from "@/lib/agent/batch";

const requestSchema = z.object({
  companyId: z.string().uuid("companyId must be a valid UUID"),
});

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();

    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }

    const result = await processCompanyForBatch({
      companyId: parsed.data.companyId,
      userId: user.id,
      supabase,
    });

    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

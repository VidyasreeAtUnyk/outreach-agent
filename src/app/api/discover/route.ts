/**
 * POST /api/discover
 * Searches for companies matching a natural-language description and
 * persists each as a lightweight 'discovered' company row. Rate limited
 * like the other AI-calling routes, since it makes one OpenAI call to
 * extract candidates from search results — see lib/agent/discover.ts.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireUser, requireWithinRateLimit, toErrorResponse, ApiError } from "@/lib/api-utils";
import { discoverCompanies } from "@/lib/agent/discover";

const requestSchema = z.object({
  query: z.string().min(3, "query must be at least 3 characters").max(200, "query must be at most 200 characters"),
});

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    requireWithinRateLimit(user.id);

    const body: unknown = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, parsed.error.issues.map((i) => i.message).join("; "));
    }

    const result = await discoverCompanies({
      query: parsed.data.query,
      userId: user.id,
      supabase,
    });

    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

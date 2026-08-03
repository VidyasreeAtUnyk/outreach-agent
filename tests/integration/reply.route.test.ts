import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers";

const { checkRateLimitMock, runJsonCompletionMock } = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
  runJsonCompletionMock: vi.fn(),
}));

let mockSupabase: ReturnType<typeof createMockSupabase>;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mockSupabase }));
vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/integrations/openai", () => ({ runJsonCompletion: runJsonCompletionMock }));

const VALID_DRAFT_ID = "33333333-3333-3333-3333-333333333333";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/tracker/reply", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/tracker/reply", () => {
  beforeEach(() => {
    checkRateLimitMock.mockReset().mockReturnValue({ allowed: true, remaining: 9, resetAt: new Date() });
    runJsonCompletionMock.mockReset();
  });

  it("returns 400 when replyBody is missing", async () => {
    mockSupabase = createMockSupabase([]);
    const { POST } = await import("@/app/api/tracker/reply/route");
    const response = await POST(request({ draftId: VALID_DRAFT_ID }));
    expect(response.status).toBe(400);
  });

  it("returns 404 when the draft doesn't exist", async () => {
    mockSupabase = createMockSupabase([{ data: null, error: { message: "not found" } }]);
    const { POST } = await import("@/app/api/tracker/reply/route");
    const response = await POST(request({ draftId: VALID_DRAFT_ID, replyBody: "Sounds interesting!" }));
    expect(response.status).toBe(404);
  });

  it("logs the reply and returns the AI-suggested response", async () => {
    mockSupabase = createMockSupabase([
      { data: { id: VALID_DRAFT_ID, subject: "Subject", body: "Body", company_id: "company-1" }, error: null },
      { data: { id: "reply-1" }, error: null },
    ]);
    runJsonCompletionMock.mockResolvedValue({
      sentiment: "positive",
      suggestedResponse: "Great — how does Tuesday at 3pm work for a quick call?",
    });

    const { POST } = await import("@/app/api/tracker/reply/route");
    const response = await POST(request({ draftId: VALID_DRAFT_ID, replyBody: "Sounds interesting, let's talk!" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.sentiment).toBe("positive");
    expect(json.suggestedResponse).toContain("Tuesday");
  });
});

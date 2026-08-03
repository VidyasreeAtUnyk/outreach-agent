import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers";

const { checkRateLimitMock, matchCompanyToProjectMock, draftEmailWithScoreMock, deriveScoreResultMock } = vi.hoisted(
  () => ({
    checkRateLimitMock: vi.fn(),
    matchCompanyToProjectMock: vi.fn(),
    draftEmailWithScoreMock: vi.fn(),
    deriveScoreResultMock: vi.fn(),
  }),
);

let mockSupabase: ReturnType<typeof createMockSupabase>;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mockSupabase }));
vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/agent/match", () => ({ matchCompanyToProject: matchCompanyToProjectMock }));
vi.mock("@/lib/agent/draft", () => ({ draftEmailWithScore: draftEmailWithScoreMock }));
vi.mock("@/lib/agent/score", () => ({ deriveScoreResult: deriveScoreResultMock }));

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/draft", { method: "POST", body: JSON.stringify(body) });
}

const VALID_COMPANY_ID = "11111111-1111-1111-1111-111111111111";

describe("POST /api/draft", () => {
  beforeEach(() => {
    checkRateLimitMock.mockReset().mockReturnValue({ allowed: true, remaining: 9, resetAt: new Date() });
    matchCompanyToProjectMock.mockReset().mockReturnValue({
      projectId: "lead-follow-up-agent",
      score: 8,
      reasoning: "matches",
      needsCustomisation: false,
      customisationNotes: null,
    });
    draftEmailWithScoreMock
      .mockReset()
      .mockResolvedValue({ subject: "Subject", body: "Body", wordCount: 2, rawScore: 8, scoreReasoning: "strong fit" });
    deriveScoreResultMock.mockReset().mockReturnValue({ score: 8, reasoning: "strong fit", recommendation: "send" });
  });

  it("returns 400 for a non-UUID companyId", async () => {
    mockSupabase = createMockSupabase([]);
    const { POST } = await import("@/app/api/draft/route");
    const response = await POST(postRequest({ companyId: "not-a-uuid" }));
    expect(response.status).toBe(400);
  });

  it("returns 404 when the company doesn't exist", async () => {
    mockSupabase = createMockSupabase([{ data: null, error: { message: "not found" } }]);
    const { POST } = await import("@/app/api/draft/route");
    const response = await POST(postRequest({ companyId: VALID_COMPANY_ID }));
    expect(response.status).toBe(404);
  });

  it("regenerates a draft for an existing company and returns 200", async () => {
    mockSupabase = createMockSupabase([
      { data: { id: VALID_COMPANY_ID, industry: "proptech", pain_point: "x", tech_signals: [], hiring_signals: [] }, error: null },
      { data: null, error: null }, // contact lookup (maybeSingle) — none found
      { data: { id: "draft-2" }, error: null },
    ]);
    const { POST } = await import("@/app/api/draft/route");
    const response = await POST(postRequest({ companyId: VALID_COMPANY_ID }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.draftId).toBe("draft-2");
  });
});

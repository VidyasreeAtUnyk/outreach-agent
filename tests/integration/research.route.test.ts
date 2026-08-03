import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers";

const {
  checkRateLimitMock,
  researchCompanyMock,
  matchCompanyToProjectMock,
  draftEmailWithScoreMock,
  deriveScoreResultMock,
} = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
  researchCompanyMock: vi.fn(),
  matchCompanyToProjectMock: vi.fn(),
  draftEmailWithScoreMock: vi.fn(),
  deriveScoreResultMock: vi.fn(),
}));

let mockSupabase: ReturnType<typeof createMockSupabase>;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mockSupabase }));
vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/agent/research", () => ({ researchCompany: researchCompanyMock }));
vi.mock("@/lib/agent/match", () => ({ matchCompanyToProject: matchCompanyToProjectMock }));
vi.mock("@/lib/agent/draft", () => ({ draftEmailWithScore: draftEmailWithScoreMock }));
vi.mock("@/lib/agent/score", () => ({ deriveScoreResult: deriveScoreResultMock }));

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/research", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/research", () => {
  beforeEach(() => {
    checkRateLimitMock.mockReset().mockReturnValue({ allowed: true, remaining: 9, resetAt: new Date() });
    researchCompanyMock.mockReset();
    matchCompanyToProjectMock.mockReset();
    draftEmailWithScoreMock.mockReset();
    deriveScoreResultMock.mockReset();
    mockSupabase = createMockSupabase([{ data: { id: "draft-1" }, error: null }]);
  });

  it("returns 400 for an invalid company URL", async () => {
    const { POST } = await import("@/app/api/research/route");
    const response = await POST(postRequest({ companyUrl: "not-a-url" }));
    expect(response.status).toBe(400);
  });

  it("returns 429 when the rate limit has been exceeded", async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false, remaining: 0, resetAt: new Date() });
    const { POST } = await import("@/app/api/research/route");
    const response = await POST(postRequest({ companyUrl: "https://www.bayut.com" }));
    expect(response.status).toBe(429);
  });

  it("runs the full pipeline with exactly one draft+score call and returns 200 with the created ids", async () => {
    researchCompanyMock.mockResolvedValue({
      company: { id: "company-1", industry: "proptech", painPoint: "x", description: "y", techSignals: [], hiringSignals: [] },
      contact: { id: "contact-1", name: "Haider Ali Khan", title: "CEO" },
      incompleteSteps: [],
    });
    matchCompanyToProjectMock.mockReturnValue({
      projectId: "lead-follow-up-agent",
      score: 8,
      reasoning: "matches",
      needsCustomisation: false,
      customisationNotes: null,
    });
    draftEmailWithScoreMock.mockResolvedValue({
      subject: "Subject",
      body: "Body",
      wordCount: 2,
      rawScore: 8,
      scoreReasoning: "strong fit",
    });
    deriveScoreResultMock.mockReturnValue({ score: 8, reasoning: "strong fit", recommendation: "send" });

    const { POST } = await import("@/app/api/research/route");
    const response = await POST(postRequest({ companyUrl: "https://www.bayut.com" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.draftId).toBe("draft-1");
    expect(json.companyId).toBe("company-1");
    expect(draftEmailWithScoreMock).toHaveBeenCalledTimes(1);
  });

  it("still returns 200 with the saved company/contact ids when drafting fails after research succeeds", async () => {
    researchCompanyMock.mockResolvedValue({
      company: { id: "company-1", industry: "proptech", painPoint: "x", description: "y", techSignals: [], hiringSignals: [] },
      contact: { id: "contact-1", name: "Haider Ali Khan", title: "CEO" },
      incompleteSteps: [],
    });
    matchCompanyToProjectMock.mockReturnValue({
      projectId: "lead-follow-up-agent",
      score: 8,
      reasoning: "matches",
      needsCustomisation: false,
      customisationNotes: null,
    });
    draftEmailWithScoreMock.mockRejectedValue(
      Object.assign(new Error("[openai] call budget exhausted (50/50 used)"), { code: "budget_exhausted" }),
    );

    const { POST } = await import("@/app/api/research/route");
    const response = await POST(postRequest({ companyUrl: "https://www.bayut.com" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.companyId).toBe("company-1");
    expect(json.contactId).toBe("contact-1");
    expect(json.draftId).toBeNull();
    expect(json.draftError).toContain("budget exhausted");
  });
});

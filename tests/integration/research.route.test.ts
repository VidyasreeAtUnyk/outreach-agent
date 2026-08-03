import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers";

const { checkRateLimitMock, researchCompanyMock, matchCompanyToProjectMock, draftEmailMock, scoreApplicationMock } =
  vi.hoisted(() => ({
    checkRateLimitMock: vi.fn(),
    researchCompanyMock: vi.fn(),
    matchCompanyToProjectMock: vi.fn(),
    draftEmailMock: vi.fn(),
    scoreApplicationMock: vi.fn(),
  }));

let mockSupabase: ReturnType<typeof createMockSupabase>;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mockSupabase }));
vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/agent/research", () => ({ researchCompany: researchCompanyMock }));
vi.mock("@/lib/agent/match", () => ({ matchCompanyToProject: matchCompanyToProjectMock }));
vi.mock("@/lib/agent/draft", () => ({ draftEmail: draftEmailMock }));
vi.mock("@/lib/agent/score", () => ({ scoreApplication: scoreApplicationMock }));

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
    draftEmailMock.mockReset();
    scoreApplicationMock.mockReset();
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

  it("runs the full pipeline and returns 200 with the created ids", async () => {
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
    draftEmailMock.mockResolvedValue({ subject: "Subject", body: "Body", wordCount: 2 });
    scoreApplicationMock.mockResolvedValue({ score: 8, reasoning: "strong fit", recommendation: "send" });

    const { POST } = await import("@/app/api/research/route");
    const response = await POST(postRequest({ companyUrl: "https://www.bayut.com" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.draftId).toBe("draft-1");
    expect(json.companyId).toBe("company-1");
  });
});

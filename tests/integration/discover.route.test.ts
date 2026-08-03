import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers";

const { checkRateLimitMock, discoverCompaniesMock } = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
  discoverCompaniesMock: vi.fn(),
}));

let mockSupabase: ReturnType<typeof createMockSupabase>;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mockSupabase }));
vi.mock("@/lib/ratelimit", () => ({ checkRateLimit: checkRateLimitMock }));
vi.mock("@/lib/agent/discover", () => ({ discoverCompanies: discoverCompaniesMock }));

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/discover", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/discover", () => {
  beforeEach(() => {
    checkRateLimitMock.mockReset().mockReturnValue({ allowed: true, remaining: 9, resetAt: new Date() });
    discoverCompaniesMock.mockReset();
    mockSupabase = createMockSupabase([]);
  });

  it("returns 400 for a too-short query", async () => {
    const { POST } = await import("@/app/api/discover/route");
    const response = await POST(postRequest({ query: "ai" }));
    expect(response.status).toBe(400);
  });

  it("returns 429 when the rate limit has been exceeded", async () => {
    checkRateLimitMock.mockReturnValue({ allowed: false, remaining: 0, resetAt: new Date() });
    const { POST } = await import("@/app/api/discover/route");
    const response = await POST(postRequest({ query: "AI agent companies with UAE presence" }));
    expect(response.status).toBe(429);
  });

  it("returns the discovered candidates on success", async () => {
    discoverCompaniesMock.mockResolvedValue({
      discovered: [
        { id: "stub-1", name: "Wokeworks", url: "https://wokeworks.ai", reason: "matches", alreadyKnown: false },
      ],
      incompleteSteps: [],
    });

    const { POST } = await import("@/app/api/discover/route");
    const response = await POST(postRequest({ query: "AI agent companies with UAE presence" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.discovered).toHaveLength(1);
    expect(json.discovered[0].name).toBe("Wokeworks");
  });
});

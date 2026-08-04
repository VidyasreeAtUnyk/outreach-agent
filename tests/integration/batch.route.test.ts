import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers";

const { processCompanyForBatchMock } = vi.hoisted(() => ({
  processCompanyForBatchMock: vi.fn(),
}));

let mockSupabase: ReturnType<typeof createMockSupabase>;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mockSupabase }));
vi.mock("@/lib/agent/batch", () => ({ processCompanyForBatch: processCompanyForBatchMock }));

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/batch/process-company", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/batch/process-company", () => {
  beforeEach(() => {
    processCompanyForBatchMock.mockReset();
    mockSupabase = createMockSupabase([]);
  });

  it("returns 400 for a non-UUID companyId", async () => {
    const { POST } = await import("@/app/api/batch/process-company/route");
    const response = await POST(postRequest({ companyId: "not-a-uuid" }));
    expect(response.status).toBe(400);
  });

  it("returns 200 with the per-phase result even when the underlying processing reports failures", async () => {
    processCompanyForBatchMock.mockResolvedValue({
      companyId: "11111111-1111-1111-1111-111111111111",
      companyName: "Wokeworks",
      researched: true,
      researchError: null,
      score: { score: 3, reasoning: "weak fit", recommendation: "skip" },
      scoreError: null,
      skippedDraft: true,
      drafted: false,
      draftId: null,
      draftError: null,
    });

    const { POST } = await import("@/app/api/batch/process-company/route");
    const response = await POST(postRequest({ companyId: "11111111-1111-1111-1111-111111111111" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.skippedDraft).toBe(true);
    expect(json.score.recommendation).toBe("skip");
  });

  it("is not gated by the shared rate limiter (no checkRateLimit call)", async () => {
    processCompanyForBatchMock.mockResolvedValue({
      companyId: "11111111-1111-1111-1111-111111111111",
      companyName: "Wokeworks",
      researched: true,
      researchError: null,
      score: null,
      scoreError: null,
      skippedDraft: false,
      drafted: false,
      draftId: null,
      draftError: null,
    });

    const { POST } = await import("@/app/api/batch/process-company/route");
    const response = await POST(postRequest({ companyId: "11111111-1111-1111-1111-111111111111" }));

    expect(response.status).toBe(200);
    expect(processCompanyForBatchMock).toHaveBeenCalledTimes(1);
  });
});

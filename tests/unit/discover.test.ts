import { describe, expect, it, vi, beforeEach } from "vitest";
import { discoverCompanies } from "@/lib/agent/discover";

const { tavilySearchMock, runJsonCompletionMock } = vi.hoisted(() => ({
  tavilySearchMock: vi.fn(),
  runJsonCompletionMock: vi.fn(),
}));

vi.mock("@/lib/integrations/tavily", () => ({ tavilySearch: tavilySearchMock }));
vi.mock("@/lib/integrations/openai", () => ({ runJsonCompletion: runJsonCompletionMock }));

/** Fake Supabase client supporting the two shapes discover.ts uses: an awaited select().eq() for dedup lookup, and insert().select().single() for new stub rows. */
function createFakeSupabase(existingRows: { id: string; name: string; url: string }[]) {
  let nextId = 100;
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: existingRows, error: null }),
      }),
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: async () => ({
            data: { id: `stub-${nextId++}`, name: values.name, url: values.url },
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe("discoverCompanies", () => {
  beforeEach(() => {
    tavilySearchMock.mockReset();
    runJsonCompletionMock.mockReset();
  });

  it("returns an empty result and records incompleteSteps when the search finds nothing", async () => {
    tavilySearchMock.mockResolvedValue([]);

    const result = await discoverCompanies({
      query: "AI agent companies with UAE presence",
      userId: "user-1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake client only implements the chain discover.ts uses
      supabase: createFakeSupabase([]) as any,
    });

    expect(result.discovered).toEqual([]);
    expect(result.incompleteSteps).toContain("discovery_search");
    expect(runJsonCompletionMock).not.toHaveBeenCalled();
  });

  it("makes exactly one OpenAI call regardless of how many candidates are found", async () => {
    tavilySearchMock.mockResolvedValue([
      { title: "Top AI startups in UAE", url: "https://news.example.com/list", content: "Wokeworks, Sample AI..." },
    ]);
    runJsonCompletionMock.mockResolvedValue({
      companies: [
        { name: "Wokeworks", url: "https://wokeworks.ai", reason: "AI agents, UAE presence" },
        { name: "Sample AI", url: "https://sampleai.com", reason: "AI agents, UAE presence" },
      ],
    });

    const result = await discoverCompanies({
      query: "AI agent companies with UAE presence",
      userId: "user-1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: createFakeSupabase([]) as any,
    });

    expect(runJsonCompletionMock).toHaveBeenCalledTimes(1);
    expect(result.discovered).toHaveLength(2);
    expect(result.discovered[0]?.alreadyKnown).toBe(false);
  });

  it("marks a candidate as alreadyKnown instead of inserting a duplicate when its domain already exists", async () => {
    tavilySearchMock.mockResolvedValue([{ title: "t", url: "https://news.example.com", content: "c" }]);
    runJsonCompletionMock.mockResolvedValue({
      companies: [{ name: "Wokeworks", url: "https://www.wokeworks.ai/about", reason: "matches" }],
    });

    const result = await discoverCompanies({
      query: "AI agent companies with UAE presence",
      userId: "user-1",
      supabase: createFakeSupabase([
        { id: "existing-1", name: "Wokeworks", url: "https://wokeworks.ai" },
      ]) as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    });

    expect(result.discovered).toHaveLength(1);
    expect(result.discovered[0]).toMatchObject({ id: "existing-1", alreadyKnown: true });
  });
});

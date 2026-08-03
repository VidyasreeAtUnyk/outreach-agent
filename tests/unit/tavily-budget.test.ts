import { describe, expect, it, vi, beforeEach } from "vitest";

const { fetchMock, rpcMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  rpcMock: vi.fn(),
}));

/** Mirrors the shape of Supabase's .rpc() result used in tests/unit/openai-budget.test.ts. */
function makeRpcResult(result: { data: unknown; error: unknown }) {
  return {
    single: () => Promise.resolve(result),
    then: (onFulfilled: (v: typeof result) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
}

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc: rpcMock }),
}));

describe("tavilySearch — credit budget", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    rpcMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
  });

  it("reserves a credit and returns results when under budget", async () => {
    rpcMock.mockReturnValue(
      makeRpcResult({ data: { credits_used: 3, credit_budget: 1000, allowed: true, period: "2026-08" }, error: null }),
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ query: "q", results: [{ title: "t", url: "https://x.com", content: "c" }] }),
    });

    const { tavilySearch } = await import("@/lib/integrations/tavily");
    const results = await tavilySearch("Bayut UAE product features");

    expect(results).toHaveLength(1);
    expect(rpcMock).toHaveBeenCalledWith("increment_tavily_usage");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).not.toHaveBeenCalledWith("decrement_tavily_usage");
  });

  it("skips the search (returns []) without calling fetch once the monthly quota is exhausted", async () => {
    rpcMock.mockReturnValue(
      makeRpcResult({ data: { credits_used: 1000, credit_budget: 1000, allowed: false, period: "2026-08" }, error: null }),
    );

    const { tavilySearch } = await import("@/lib/integrations/tavily");
    const results = await tavilySearch("Bayut UAE product features");

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases the reservation if the request fails before any response is received", async () => {
    rpcMock.mockReturnValue(
      makeRpcResult({ data: { credits_used: 3, credit_budget: 1000, allowed: true, period: "2026-08" }, error: null }),
    );
    fetchMock.mockRejectedValue(new Error("network error"));

    const { tavilySearch } = await import("@/lib/integrations/tavily");
    const results = await tavilySearch("Bayut UAE product features");

    expect(results).toEqual([]);
    expect(rpcMock).toHaveBeenCalledWith("decrement_tavily_usage");
  });

  it("does NOT release the reservation when a response is received but fails schema validation", async () => {
    rpcMock.mockReturnValue(
      makeRpcResult({ data: { credits_used: 3, credit_budget: 1000, allowed: true, period: "2026-08" }, error: null }),
    );
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ malformed: true }) });

    const { tavilySearch } = await import("@/lib/integrations/tavily");
    const results = await tavilySearch("Bayut UAE product features");

    expect(results).toEqual([]);
    expect(rpcMock).not.toHaveBeenCalledWith("decrement_tavily_usage");
  });
});

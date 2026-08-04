import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

const { createMock, rpcMock, MockAPIError, MockOpenAI } = vi.hoisted(() => {
  class HoistedMockAPIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  const hoistedCreateMock = vi.fn();
  const hoistedMockOpenAi = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: hoistedCreateMock } },
  })) as unknown as { APIError: typeof HoistedMockAPIError } & (() => unknown);
  hoistedMockOpenAi.APIError = HoistedMockAPIError;

  return {
    createMock: hoistedCreateMock,
    rpcMock: vi.fn(),
    MockAPIError: HoistedMockAPIError,
    MockOpenAI: hoistedMockOpenAi,
  };
});

/** Supabase's real .rpc() result is both awaitable directly and chainable with .single() — this fake supports both call shapes used in lib/integrations/openai.ts. */
function makeRpcResult(result: { data: unknown; error: unknown }) {
  return {
    single: () => Promise.resolve(result),
    then: (onFulfilled: (v: typeof result) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
}

vi.mock("openai", () => ({
  default: MockOpenAI,
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc: rpcMock }),
}));

describe("runJsonCompletion — OpenAI call budget", () => {
  beforeEach(() => {
    createMock.mockReset();
    rpcMock.mockReset();
    vi.resetModules();
  });

  const schema = z.object({ ok: z.boolean() });

  it("reserves a call, makes the request, and returns the parsed response when under budget", async () => {
    rpcMock.mockReturnValue(makeRpcResult({ data: { calls_used: 5, call_budget: 50, allowed: true }, error: null }));
    createMock.mockResolvedValue({ choices: [{ message: { content: '{"ok": true}' } }] });

    const { runJsonCompletion } = await import("@/lib/integrations/openai");
    const result = await runJsonCompletion({ systemPrompt: "sys", userContent: "user", schema, label: "test" });

    expect(result).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("increment_openai_usage");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).not.toHaveBeenCalledWith("decrement_openai_usage");
  });

  it("refuses to call OpenAI at all once the budget is exhausted", async () => {
    rpcMock.mockReturnValue(makeRpcResult({ data: { calls_used: 50, call_budget: 50, allowed: false }, error: null }));

    const { runJsonCompletion } = await import("@/lib/integrations/openai");

    await expect(
      runJsonCompletion({ systemPrompt: "sys", userContent: "user", schema, label: "test" }),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("releases the reservation if the request fails before any response is received", async () => {
    rpcMock.mockReturnValue(makeRpcResult({ data: { calls_used: 5, call_budget: 50, allowed: true }, error: null }));
    createMock.mockRejectedValue(new Error("network error"));

    const { runJsonCompletion } = await import("@/lib/integrations/openai");

    await expect(
      runJsonCompletion({ systemPrompt: "sys", userContent: "user", schema, label: "test" }),
    ).rejects.toThrow();
    expect(rpcMock).toHaveBeenCalledWith("decrement_openai_usage");
  });

  it("tags a 429 from OpenAI itself as rate_limited (distinct from our internal budget_exhausted) and releases the reservation", async () => {
    rpcMock.mockReturnValue(makeRpcResult({ data: { calls_used: 5, call_budget: 50, allowed: true }, error: null }));
    createMock.mockRejectedValue(new MockAPIError(429, "Rate limit reached for gpt-5.4-mini on tokens per min"));

    const { runJsonCompletion } = await import("@/lib/integrations/openai");

    await expect(
      runJsonCompletion({ systemPrompt: "sys", userContent: "user", schema, label: "test" }),
    ).rejects.toMatchObject({ code: "rate_limited", message: expect.stringContaining("Rate limit reached") });
    expect(rpcMock).toHaveBeenCalledWith("decrement_openai_usage");
  });

  it("does NOT release the reservation when the response is received but fails schema validation", async () => {
    rpcMock.mockReturnValue(makeRpcResult({ data: { calls_used: 5, call_budget: 50, allowed: true }, error: null }));
    createMock.mockResolvedValue({ choices: [{ message: { content: '{"ok": "not-a-boolean"}' } }] });

    const { runJsonCompletion } = await import("@/lib/integrations/openai");

    await expect(
      runJsonCompletion({ systemPrompt: "sys", userContent: "user", schema, label: "test" }),
    ).rejects.toThrow();
    expect(rpcMock).not.toHaveBeenCalledWith("decrement_openai_usage");
  });
});

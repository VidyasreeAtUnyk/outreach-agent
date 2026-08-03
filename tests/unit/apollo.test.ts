import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { fetchMock, rpcMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  rpcMock: vi.fn(),
}));

/** Mirrors the shape of Supabase's .rpc() result used in the openai/tavily budget tests. */
function makeRpcResult(result: { data: unknown; error: unknown }) {
  return {
    single: () => Promise.resolve(result),
    then: (onFulfilled: (v: typeof result) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
}

const ALLOWED_RESERVATION = makeRpcResult({
  data: { credits_used: 3, credit_budget: 90, allowed: true, period: "2026-08" },
  error: null,
});

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ rpc: rpcMock }),
}));

describe("apollo integration", () => {
  const originalApolloKey = process.env.APOLLO_API_KEY;

  beforeEach(() => {
    fetchMock.mockReset();
    rpcMock.mockReset().mockReturnValue(ALLOWED_RESERVATION);
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
  });

  afterEach(() => {
    process.env.APOLLO_API_KEY = originalApolloKey;
  });

  it("returns null without calling fetch when APOLLO_API_KEY is unset", async () => {
    delete process.env.APOLLO_API_KEY;
    vi.resetModules();

    const { findExecutiveContact } = await import("@/lib/integrations/apollo");
    const result = await findExecutiveContact("https://www.bayut.com");

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the first person with a usable email from a people search", async () => {
    process.env.APOLLO_API_KEY = "test-apollo-key";
    vi.resetModules();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        people: [
          { email: "email_not_unlocked@bayut.com", first_name: "A", last_name: "B", title: "VP" },
          {
            email: "haider@bayut.com",
            first_name: "Haider",
            last_name: "Ali Khan",
            title: "CEO",
            linkedin_url: "https://linkedin.com/in/haider",
            email_status: "verified",
          },
        ],
      }),
    });

    const { findExecutiveContact } = await import("@/lib/integrations/apollo");
    const result = await findExecutiveContact("https://www.bayut.com");

    expect(result).toEqual({
      email: "haider@bayut.com",
      name: "Haider Ali Khan",
      title: "CEO",
      linkedinUrl: "https://linkedin.com/in/haider",
      verified: true,
      foundVia: "apollo",
    });
  });

  it("treats a masked placeholder email as not found", async () => {
    process.env.APOLLO_API_KEY = "test-apollo-key";
    vi.resetModules();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        people: [{ email: "email_not_unlocked@bayut.com", first_name: "A", last_name: "B", title: "CTO" }],
      }),
    });

    const { findExecutiveContact } = await import("@/lib/integrations/apollo");
    const result = await findExecutiveContact("https://www.bayut.com");

    expect(result).toBeNull();
  });

  it("findEmailForNamedContact returns the matched person's email", async () => {
    process.env.APOLLO_API_KEY = "test-apollo-key";
    vi.resetModules();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        person: {
          email: "faisal@ziina.com",
          first_name: "Faisal",
          last_name: "Toukan",
          title: "CEO",
          email_status: "verified",
        },
      }),
    });

    const { findEmailForNamedContact } = await import("@/lib/integrations/apollo");
    const result = await findEmailForNamedContact("https://www.ziina.com", "Faisal", "Toukan");

    expect(result?.email).toBe("faisal@ziina.com");
    expect(result?.foundVia).toBe("apollo");
  });

  it("returns null when the request fails", async () => {
    process.env.APOLLO_API_KEY = "test-apollo-key";
    vi.resetModules();
    fetchMock.mockResolvedValue({ ok: false, status: 500 });

    const { findExecutiveContact } = await import("@/lib/integrations/apollo");
    const result = await findExecutiveContact("https://www.bayut.com");

    expect(result).toBeNull();
  });
});

describe("apollo integration — credit budget", () => {
  const originalApolloKey = process.env.APOLLO_API_KEY;

  beforeEach(() => {
    process.env.APOLLO_API_KEY = "test-apollo-key";
    fetchMock.mockReset();
    rpcMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
  });

  afterEach(() => {
    process.env.APOLLO_API_KEY = originalApolloKey;
  });

  it("skips the lookup (returns null) without calling fetch once the cycle's quota is exhausted", async () => {
    rpcMock.mockReturnValue(
      makeRpcResult({ data: { credits_used: 90, credit_budget: 90, allowed: false, period: "2026-08" }, error: null }),
    );

    const { findExecutiveContact } = await import("@/lib/integrations/apollo");
    const result = await findExecutiveContact("https://www.bayut.com");

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases the reservation if the request fails before any response is received", async () => {
    rpcMock.mockReturnValue(ALLOWED_RESERVATION);
    fetchMock.mockRejectedValue(new Error("network error"));

    const { findExecutiveContact } = await import("@/lib/integrations/apollo");
    const result = await findExecutiveContact("https://www.bayut.com");

    expect(result).toBeNull();
    expect(rpcMock).toHaveBeenCalledWith("decrement_apollo_usage");
  });

  it("does NOT release the reservation when a response is received but fails schema validation", async () => {
    rpcMock.mockReturnValue(ALLOWED_RESERVATION);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ malformed: true, people: "not-an-array" }) });

    const { findExecutiveContact } = await import("@/lib/integrations/apollo");
    const result = await findExecutiveContact("https://www.bayut.com");

    expect(result).toBeNull();
    expect(rpcMock).not.toHaveBeenCalledWith("decrement_apollo_usage");
  });
});

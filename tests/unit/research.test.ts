import { describe, expect, it, vi, beforeEach } from "vitest";
import { researchCompany } from "@/lib/agent/research";

const { tavilySearchMock, fetchPageTextMock, runJsonCompletionMock, findExecutiveContactMock, findEmailForNamedContactMock } =
  vi.hoisted(() => ({
    tavilySearchMock: vi.fn(),
    fetchPageTextMock: vi.fn(),
    runJsonCompletionMock: vi.fn(),
    findExecutiveContactMock: vi.fn(),
    findEmailForNamedContactMock: vi.fn(),
  }));

vi.mock("@/lib/integrations/tavily", () => ({ tavilySearch: tavilySearchMock }));
vi.mock("@/lib/integrations/webpage", () => ({ fetchPageText: fetchPageTextMock }));
vi.mock("@/lib/integrations/openai", () => ({ runJsonCompletion: runJsonCompletionMock }));
vi.mock("@/lib/integrations/hunter", () => ({
  findExecutiveContact: findExecutiveContactMock,
  findEmailForNamedContact: findEmailForNamedContactMock,
}));

/** Minimal fake Supabase client supporting the .from().insert().select().single() chain used by research.ts. */
function createFakeSupabase(rowsByTable: Record<string, Record<string, unknown>>) {
  return {
    from: (table: string) => ({
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: async () => ({
            data: { id: `${table}-id`, ...values, ...rowsByTable[table] },
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe("researchCompany", () => {
  beforeEach(() => {
    tavilySearchMock.mockReset();
    fetchPageTextMock.mockReset();
    runJsonCompletionMock.mockReset();
    findExecutiveContactMock.mockReset();
    findEmailForNamedContactMock.mockReset();
  });

  it("continues and records incompleteSteps when search/fetch steps return nothing", async () => {
    tavilySearchMock.mockResolvedValue([]);
    fetchPageTextMock.mockResolvedValue(null);
    findExecutiveContactMock.mockResolvedValue(null);
    runJsonCompletionMock.mockResolvedValue({
      companyName: "Bayut",
      description: "A property listings platform.",
      painPoint: null,
      techSignals: [],
      hiringSignals: [],
      recentNews: null,
      stage: null,
      size: null,
      industry: "proptech",
      urgencyNotes: null,
    });

    const supabase = createFakeSupabase({});

    const result = await researchCompany({
      companyUrl: "https://www.bayut.com",
      userId: "user-1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake client only implements the chain research.ts uses
      supabase: supabase as any,
    });

    expect(result.company.name).toBe("Bayut");
    expect(result.contact).toBeNull();
    expect(result.incompleteSteps).toContain("product_feature_search");
    expect(result.incompleteSteps).toContain("homepage_fetch");
    expect(result.incompleteSteps).toContain("contact_discovery");
  });

  it("throws if synthesis itself fails, since a company with no synthesis isn't useful to save", async () => {
    tavilySearchMock.mockResolvedValue([]);
    fetchPageTextMock.mockResolvedValue(null);
    runJsonCompletionMock.mockRejectedValue(new Error("openai down"));

    const supabase = createFakeSupabase({});

    await expect(
      researchCompany({
        companyUrl: "https://www.bayut.com",
        userId: "user-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase: supabase as any,
      }),
    ).rejects.toThrow("openai down");
  });

  it("saves a found executive contact when no contact name was provided", async () => {
    tavilySearchMock.mockResolvedValue([]);
    fetchPageTextMock.mockResolvedValue(null);
    runJsonCompletionMock.mockResolvedValue({
      companyName: "Bayut",
      description: "A property listings platform.",
      painPoint: null,
      techSignals: [],
      hiringSignals: [],
      recentNews: null,
      stage: null,
      size: null,
      industry: "proptech",
      urgencyNotes: null,
    });
    findExecutiveContactMock.mockResolvedValue({
      email: "ceo@bayut.com",
      name: "Haider Ali Khan",
      title: "CEO",
      linkedinUrl: null,
      verified: true,
    });

    const supabase = createFakeSupabase({});

    const result = await researchCompany({
      companyUrl: "https://www.bayut.com",
      userId: "user-1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: supabase as any,
    });

    expect(result.contact?.email).toBe("ceo@bayut.com");
    expect(result.incompleteSteps).not.toContain("contact_discovery");
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { processCompanyForBatch } from "@/lib/agent/batch";

const { researchCompanyMock, matchCompanyToProjectMock, scoreApplicationMock, draftEmailMock } = vi.hoisted(() => ({
  researchCompanyMock: vi.fn(),
  matchCompanyToProjectMock: vi.fn(),
  scoreApplicationMock: vi.fn(),
  draftEmailMock: vi.fn(),
}));

vi.mock("@/lib/agent/research", () => ({ researchCompany: researchCompanyMock }));
vi.mock("@/lib/agent/match", () => ({ matchCompanyToProject: matchCompanyToProjectMock }));
vi.mock("@/lib/agent/draft", () => ({ draftEmail: draftEmailMock }));
// Keep the real (pure) deriveScoreResult so clamping/recommendation logic
// in assertions reflects actual behavior; only scoreApplication (the LLM
// call) is mocked.
vi.mock("@/lib/agent/score", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent/score")>("@/lib/agent/score");
  return { ...actual, scoreApplication: scoreApplicationMock };
});

const BASE_COMPANY_ROW = {
  id: "company-1",
  user_id: "user-1",
  name: "Wokeworks",
  url: "https://wokeworks.ai",
  industry: "b2b",
  size: "startup",
  stage: null,
  location: null,
  description: "An AI agent company.",
  pain_point: "scaling support",
  tech_signals: [],
  hiring_signals: [],
  recent_news: null,
  research_status: "discovered",
  discovery_score: 9,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/** Fake Supabase client covering the exact table/method sequence batch.ts uses: companies.select, drafts.select (existing-draft check), contacts.select (latest contact), drafts.insert. */
function createFakeSupabase(opts: {
  companyRow?: Record<string, unknown> | null;
  companyError?: { message: string } | null;
  existingDraft?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  insertedDraft?: { id: string } | null;
  insertError?: { message: string } | null;
}) {
  return {
    from: (table: string) => {
      if (table === "companies") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: opts.companyRow ?? null, error: opts.companyError ?? null }),
            }),
          }),
        };
      }
      if (table === "drafts") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: opts.existingDraft ?? null, error: null }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: opts.insertedDraft ?? null,
                error: opts.insertError ?? null,
              }),
            }),
          }),
        };
      }
      if (table === "contacts") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: opts.contact ?? null, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table in test fake: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fake only implements the chain batch.ts uses
  } as any;
}

const MATCH_RESULT = {
  projectId: "lead-follow-up-agent",
  score: 8,
  reasoning: "matches",
  needsCustomisation: false,
  customisationNotes: null,
};

describe("processCompanyForBatch", () => {
  beforeEach(() => {
    researchCompanyMock.mockReset();
    matchCompanyToProjectMock.mockReset().mockReturnValue(MATCH_RESULT);
    scoreApplicationMock.mockReset();
    draftEmailMock.mockReset();
  });

  it("is idempotent: returns the existing draft without re-researching/scoring/drafting", async () => {
    const supabase = createFakeSupabase({
      companyRow: BASE_COMPANY_ROW,
      existingDraft: { id: "draft-existing", confidence_score: 7, confidence_reason: "prior run" },
    });

    const result = await processCompanyForBatch({ companyId: "company-1", userId: "user-1", supabase });

    expect(result.drafted).toBe(true);
    expect(result.draftId).toBe("draft-existing");
    expect(result.score).toEqual({ score: 7, reasoning: "prior run", recommendation: "review" });
    expect(researchCompanyMock).not.toHaveBeenCalled();
    expect(scoreApplicationMock).not.toHaveBeenCalled();
    expect(draftEmailMock).not.toHaveBeenCalled();
  });

  it("researches a discovered (not yet researched) company before scoring", async () => {
    researchCompanyMock.mockResolvedValue({
      company: { ...toDomainCompany(BASE_COMPANY_ROW), researchStatus: "researched" },
      contact: { id: "contact-1", name: "Jane Doe", title: "CEO" },
      incompleteSteps: [],
    });
    scoreApplicationMock.mockResolvedValue({ rawScore: 9, reasoning: "strong fit" });
    draftEmailMock.mockResolvedValue({ subject: "Subject", body: "Body", wordCount: 2 });

    const supabase = createFakeSupabase({
      companyRow: BASE_COMPANY_ROW, // research_status: 'discovered'
      existingDraft: null,
      insertedDraft: { id: "draft-new" },
    });

    const result = await processCompanyForBatch({ companyId: "company-1", userId: "user-1", supabase });

    expect(researchCompanyMock).toHaveBeenCalledTimes(1);
    expect(result.researched).toBe(true);
    expect(result.drafted).toBe(true);
    expect(result.draftId).toBe("draft-new");
  });

  it("skips research for an already-researched company and fetches its latest contact instead", async () => {
    scoreApplicationMock.mockResolvedValue({ rawScore: 9, reasoning: "strong fit" });
    draftEmailMock.mockResolvedValue({ subject: "Subject", body: "Body", wordCount: 2 });

    const supabase = createFakeSupabase({
      companyRow: { ...BASE_COMPANY_ROW, research_status: "researched" },
      existingDraft: null,
      contact: { id: "contact-1", name: "Jane Doe", title: "CEO", company_id: "company-1" },
      insertedDraft: { id: "draft-new" },
    });

    const result = await processCompanyForBatch({ companyId: "company-1", userId: "user-1", supabase });

    expect(researchCompanyMock).not.toHaveBeenCalled();
    expect(result.researched).toBe(true);
    expect(result.drafted).toBe(true);
  });

  it("stops at research failure without attempting to score or draft", async () => {
    researchCompanyMock.mockRejectedValue(new Error("openai down"));

    const supabase = createFakeSupabase({ companyRow: BASE_COMPANY_ROW, existingDraft: null });

    const result = await processCompanyForBatch({ companyId: "company-1", userId: "user-1", supabase });

    expect(result.researched).toBe(false);
    expect(result.researchError).toContain("openai down");
    expect(result.score).toBeNull();
    expect(draftEmailMock).not.toHaveBeenCalled();
  });

  it("stops at scoring failure without attempting to draft", async () => {
    scoreApplicationMock.mockRejectedValue(new Error("rate limited"));

    const supabase = createFakeSupabase({
      companyRow: { ...BASE_COMPANY_ROW, research_status: "researched" },
      existingDraft: null,
      contact: null,
    });

    const result = await processCompanyForBatch({ companyId: "company-1", userId: "user-1", supabase });

    expect(result.researched).toBe(true);
    expect(result.scoreError).toContain("rate limited");
    expect(draftEmailMock).not.toHaveBeenCalled();
  });

  it("skips drafting entirely when the score's recommendation is 'skip'", async () => {
    scoreApplicationMock.mockResolvedValue({ rawScore: 2, reasoning: "weak fit" });

    const supabase = createFakeSupabase({
      companyRow: { ...BASE_COMPANY_ROW, research_status: "researched" },
      existingDraft: null,
      contact: null,
    });

    const result = await processCompanyForBatch({ companyId: "company-1", userId: "user-1", supabase });

    expect(result.score?.recommendation).toBe("skip");
    expect(result.skippedDraft).toBe(true);
    expect(result.drafted).toBe(false);
    expect(draftEmailMock).not.toHaveBeenCalled();
  });

  it("marks draftError but still reports the score when drafting fails after a passing score", async () => {
    scoreApplicationMock.mockResolvedValue({ rawScore: 8, reasoning: "strong fit" });
    draftEmailMock.mockRejectedValue(new Error("token limit reached"));

    const supabase = createFakeSupabase({
      companyRow: { ...BASE_COMPANY_ROW, research_status: "researched" },
      existingDraft: null,
      contact: null,
    });

    const result = await processCompanyForBatch({ companyId: "company-1", userId: "user-1", supabase });

    expect(result.score?.recommendation).toBe("send");
    expect(result.drafted).toBe(false);
    expect(result.draftError).toContain("token limit reached");
  });
});

function toDomainCompany(row: typeof BASE_COMPANY_ROW) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    url: row.url,
    industry: row.industry,
    size: row.size,
    stage: row.stage,
    location: row.location,
    description: row.description,
    painPoint: row.pain_point,
    techSignals: row.tech_signals,
    hiringSignals: row.hiring_signals,
    recentNews: row.recent_news,
    researchStatus: row.research_status,
    discoveryScore: row.discovery_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

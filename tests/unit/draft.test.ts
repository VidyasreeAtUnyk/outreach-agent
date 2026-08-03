import { describe, expect, it, vi, beforeEach } from "vitest";
import { draftEmailWithScore } from "@/lib/agent/draft";
import { PROJECTS } from "@/lib/projects";

const { runJsonCompletionMock } = vi.hoisted(() => ({ runJsonCompletionMock: vi.fn() }));

vi.mock("@/lib/integrations/openai", () => ({
  runJsonCompletion: runJsonCompletionMock,
}));

describe("draftEmailWithScore", () => {
  beforeEach(() => {
    runJsonCompletionMock.mockReset();
  });

  it("computes word count from the returned body and passes through the raw score", async () => {
    runJsonCompletionMock.mockResolvedValue({
      subject: "A quick note on your lead follow-up",
      body: "one two three four five",
      score: 8,
      scoreReasoning: "Strong industry and pain-point fit.",
    });

    const result = await draftEmailWithScore({
      company: {
        name: "Bayut",
        industry: "proptech",
        size: "scaleup",
        painPoint: "lead management",
        description: "A UAE property listings platform.",
        techSignals: [],
        hiringSignals: [],
        recentNews: null,
      },
      contactName: "Haider Ali Khan",
      contactTitle: "CEO",
      project: PROJECTS[0]!,
      match: { score: 8, reasoning: "matches" },
    });

    expect(result.wordCount).toBe(5);
    expect(result.subject).toBe("A quick note on your lead follow-up");
    expect(result.rawScore).toBe(8);
    expect(result.scoreReasoning).toBe("Strong industry and pain-point fit.");
  });

  it("makes exactly one OpenAI call for both the draft and the score", async () => {
    runJsonCompletionMock.mockResolvedValue({
      subject: "Subject",
      body: "Body text here",
      score: 6,
      scoreReasoning: "Decent fit.",
    });

    await draftEmailWithScore({
      company: {
        name: "Bayut",
        industry: "proptech",
        size: "scaleup",
        painPoint: "lead management",
        description: null,
        techSignals: [],
        hiringSignals: [],
        recentNews: null,
      },
      contactName: "Haider Ali Khan",
      contactTitle: "CEO",
      project: PROJECTS[0]!,
      match: { score: 8, reasoning: "matches" },
      roleAppliedFor: "Senior AI Engineer",
    });

    expect(runJsonCompletionMock).toHaveBeenCalledTimes(1);
    const callArgs = runJsonCompletionMock.mock.calls[0]?.[0];
    expect(callArgs.userContent).toContain("Bayut");
    expect(callArgs.userContent).toContain("Haider Ali Khan");
    expect(callArgs.userContent).toContain("Senior AI Engineer");
    expect(callArgs.userContent).toContain(PROJECTS[0]!.name);
  });
});

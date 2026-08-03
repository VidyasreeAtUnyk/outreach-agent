import { describe, expect, it, vi, beforeEach } from "vitest";
import { draftEmail } from "@/lib/agent/draft";
import { PROJECTS } from "@/lib/projects";

const { runJsonCompletionMock } = vi.hoisted(() => ({ runJsonCompletionMock: vi.fn() }));

vi.mock("@/lib/integrations/openai", () => ({
  runJsonCompletion: runJsonCompletionMock,
}));

describe("draftEmail", () => {
  beforeEach(() => {
    runJsonCompletionMock.mockReset();
  });

  it("computes word count from the returned body", async () => {
    runJsonCompletionMock.mockResolvedValue({
      subject: "A quick note on your lead follow-up",
      body: "one two three four five",
    });

    const result = await draftEmail({
      company: {
        name: "Bayut",
        industry: "proptech",
        painPoint: "lead management",
        description: "A UAE property listings platform.",
        techSignals: [],
        hiringSignals: [],
        recentNews: null,
      },
      contactName: "Haider Ali Khan",
      contactTitle: "CEO",
      project: PROJECTS[0]!,
    });

    expect(result.wordCount).toBe(5);
    expect(result.subject).toBe("A quick note on your lead follow-up");
  });

  it("passes matched project and contact details into the prompt's user content", async () => {
    runJsonCompletionMock.mockResolvedValue({ subject: "Subject", body: "Body text here" });

    await draftEmail({
      company: {
        name: "Bayut",
        industry: "proptech",
        painPoint: "lead management",
        description: null,
        techSignals: [],
        hiringSignals: [],
        recentNews: null,
      },
      contactName: "Haider Ali Khan",
      contactTitle: "CEO",
      project: PROJECTS[0]!,
      roleAppliedFor: "Senior AI Engineer",
    });

    const callArgs = runJsonCompletionMock.mock.calls[0]?.[0];
    expect(callArgs.userContent).toContain("Bayut");
    expect(callArgs.userContent).toContain("Haider Ali Khan");
    expect(callArgs.userContent).toContain("Senior AI Engineer");
    expect(callArgs.userContent).toContain(PROJECTS[0]!.name);
  });
});

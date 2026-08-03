import { describe, expect, it, vi, beforeEach } from "vitest";
import { scoreApplication } from "@/lib/agent/score";
import { PROJECTS } from "@/lib/projects";

const { runJsonCompletionMock } = vi.hoisted(() => ({ runJsonCompletionMock: vi.fn() }));

vi.mock("@/lib/integrations/openai", () => ({
  runJsonCompletion: runJsonCompletionMock,
}));

describe("scoreApplication", () => {
  beforeEach(() => {
    runJsonCompletionMock.mockReset();
  });

  it("clamps an out-of-range model score into 1-10", async () => {
    runJsonCompletionMock.mockResolvedValue({ score: 14, reasoning: "Very strong fit." });

    const result = await scoreApplication({
      company: { name: "Bayut", industry: "proptech", size: "scaleup", painPoint: "lead management", hiringSignals: [] },
      project: PROJECTS[0]!,
      match: { projectId: PROJECTS[0]!.id, score: 8, reasoning: "matches", needsCustomisation: false, customisationNotes: null },
    });

    expect(result.score).toBe(10);
  });

  it("derives 'send' for scores at or above the send threshold", async () => {
    runJsonCompletionMock.mockResolvedValue({ score: 9, reasoning: "Strong fit." });

    const result = await scoreApplication({
      company: { name: "Bayut", industry: "proptech", size: "scaleup", painPoint: "lead management", hiringSignals: [] },
      project: PROJECTS[0]!,
      match: { projectId: PROJECTS[0]!.id, score: 8, reasoning: "matches", needsCustomisation: false, customisationNotes: null },
    });

    expect(result.recommendation).toBe("send");
  });

  it("derives 'skip' for low scores regardless of what the model's own recommendation field would say", async () => {
    runJsonCompletionMock.mockResolvedValue({ score: 2, reasoning: "Weak fit, no clear pain point." });

    const result = await scoreApplication({
      company: { name: "Some Gov Entity", industry: "government", size: "enterprise", painPoint: null, hiringSignals: [] },
      project: PROJECTS[0]!,
      match: { projectId: PROJECTS[0]!.id, score: 1, reasoning: "weak match", needsCustomisation: true, customisationNotes: null },
    });

    expect(result.recommendation).toBe("skip");
  });

  it("derives 'review' for mid-range scores", async () => {
    runJsonCompletionMock.mockResolvedValue({ score: 6, reasoning: "Decent but not certain fit." });

    const result = await scoreApplication({
      company: { name: "Ziina", industry: "fintech", size: "startup", painPoint: "financial tools", hiringSignals: [] },
      project: PROJECTS[0]!,
      match: { projectId: PROJECTS[0]!.id, score: 5, reasoning: "some match", needsCustomisation: false, customisationNotes: null },
    });

    expect(result.recommendation).toBe("review");
  });
});

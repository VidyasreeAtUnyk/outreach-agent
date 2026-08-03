import { describe, expect, it } from "vitest";
import { deriveScoreResult } from "@/lib/agent/score";

describe("deriveScoreResult", () => {
  it("clamps an out-of-range raw score into 1-10", () => {
    const result = deriveScoreResult(14, "Very strong fit.");
    expect(result.score).toBe(10);
  });

  it("clamps a below-range raw score up to 1", () => {
    const result = deriveScoreResult(-3, "Malformed model output.");
    expect(result.score).toBe(1);
  });

  it("rounds fractional scores", () => {
    const result = deriveScoreResult(7.6, "Good fit.");
    expect(result.score).toBe(8);
  });

  it("derives 'send' for scores at or above the send threshold", () => {
    expect(deriveScoreResult(9, "Strong fit.").recommendation).toBe("send");
    expect(deriveScoreResult(8, "Strong fit.").recommendation).toBe("send");
  });

  it("derives 'review' for mid-range scores", () => {
    expect(deriveScoreResult(6, "Decent but not certain fit.").recommendation).toBe("review");
    expect(deriveScoreResult(5, "Decent but not certain fit.").recommendation).toBe("review");
  });

  it("derives 'skip' for low scores", () => {
    expect(deriveScoreResult(2, "Weak fit, no clear pain point.").recommendation).toBe("skip");
    expect(deriveScoreResult(4, "Weak fit.").recommendation).toBe("skip");
  });

  it("passes the reasoning through unchanged", () => {
    const result = deriveScoreResult(7, "Some specific reasoning text.");
    expect(result.reasoning).toBe("Some specific reasoning text.");
  });
});

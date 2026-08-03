import { describe, expect, it } from "vitest";
import { matchCompanyToProject, type MatchableCompany } from "@/lib/agent/match";
import { PROJECTS } from "@/lib/projects";

describe("matchCompanyToProject", () => {
  it("matches a proptech company with lead-management pain points to the Lead Follow-Up Agent", () => {
    const company: MatchableCompany = {
      industry: "proptech",
      painPoint: "Their sales team struggles with lead management and follow up on inbound leads.",
      description: "A UAE property listings platform scaling its sales operations.",
      techSignals: ["TypeScript", "Node.js"],
      hiringSignals: ["sales automation engineer"],
    };

    const result = matchCompanyToProject(company);

    expect(result.projectId).toBe("lead-follow-up-agent");
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasoning).toContain("Lead Follow-Up Agent");
  });

  it("matches a government entity to the Social Support Portal", () => {
    const company: MatchableCompany = {
      industry: "government",
      painPoint: "Building accessible government portals with Arabic RTL support and multi-step forms.",
      description: "A UAE government social services entity.",
      techSignals: [],
      hiringSignals: ["accessibility engineer"],
    };

    const result = matchCompanyToProject(company);

    expect(result.projectId).toBe("social-support-portal");
  });

  it("flags needsCustomisation when the matched project has no live demo", () => {
    const company: MatchableCompany = {
      industry: "real_estate",
      painPoint: "They need better lead follow-up and agent ops automation.",
      description: "A real estate brokerage.",
      techSignals: [],
      hiringSignals: [],
    };

    const result = matchCompanyToProject(company);

    const project = PROJECTS.find((p) => p.id === result.projectId);
    expect(project?.demo).toBeNull();
    expect(result.needsCustomisation).toBe(true);
  });

  it("returns a default match with no crash when no signals are present at all", () => {
    const company: MatchableCompany = {
      industry: null,
      painPoint: null,
      description: null,
      techSignals: [],
      hiringSignals: [],
    };

    const result = matchCompanyToProject(company);

    expect(PROJECTS.some((p) => p.id === result.projectId)).toBe(true);
    expect(result.score).toBe(0);
  });
});

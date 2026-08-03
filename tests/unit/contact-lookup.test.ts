import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  apolloFindExecutiveMock,
  apolloFindNamedMock,
  hunterFindExecutiveMock,
  hunterFindNamedMock,
} = vi.hoisted(() => ({
  apolloFindExecutiveMock: vi.fn(),
  apolloFindNamedMock: vi.fn(),
  hunterFindExecutiveMock: vi.fn(),
  hunterFindNamedMock: vi.fn(),
}));

vi.mock("@/lib/integrations/apollo", () => ({
  findExecutiveContact: apolloFindExecutiveMock,
  findEmailForNamedContact: apolloFindNamedMock,
}));
vi.mock("@/lib/integrations/hunter", () => ({
  findExecutiveContact: hunterFindExecutiveMock,
  findEmailForNamedContact: hunterFindNamedMock,
}));

describe("contact-lookup orchestrator", () => {
  beforeEach(() => {
    apolloFindExecutiveMock.mockReset();
    apolloFindNamedMock.mockReset();
    hunterFindExecutiveMock.mockReset();
    hunterFindNamedMock.mockReset();
  });

  it("returns Apollo's result and never calls Hunter when Apollo finds a contact", async () => {
    apolloFindExecutiveMock.mockResolvedValue({
      email: "ceo@bayut.com",
      name: "Haider Ali Khan",
      title: "CEO",
      linkedinUrl: null,
      verified: true,
      foundVia: "apollo",
    });

    const { findExecutiveContact } = await import("@/lib/integrations/contact-lookup");
    const result = await findExecutiveContact("https://www.bayut.com");

    expect(result?.foundVia).toBe("apollo");
    expect(hunterFindExecutiveMock).not.toHaveBeenCalled();
  });

  it("falls back to Hunter when Apollo returns null", async () => {
    apolloFindExecutiveMock.mockResolvedValue(null);
    hunterFindExecutiveMock.mockResolvedValue({
      email: "ceo@bayut.com",
      name: "Haider Ali Khan",
      title: "CEO",
      linkedinUrl: null,
      verified: true,
      foundVia: "hunter",
    });

    const { findExecutiveContact } = await import("@/lib/integrations/contact-lookup");
    const result = await findExecutiveContact("https://www.bayut.com");

    expect(result?.foundVia).toBe("hunter");
    expect(apolloFindExecutiveMock).toHaveBeenCalledTimes(1);
    expect(hunterFindExecutiveMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when neither provider finds a contact", async () => {
    apolloFindExecutiveMock.mockResolvedValue(null);
    hunterFindExecutiveMock.mockResolvedValue(null);

    const { findExecutiveContact } = await import("@/lib/integrations/contact-lookup");
    const result = await findExecutiveContact("https://www.bayut.com");

    expect(result).toBeNull();
  });

  it("findEmailForNamedContact also tries Apollo before Hunter", async () => {
    apolloFindNamedMock.mockResolvedValue(null);
    hunterFindNamedMock.mockResolvedValue({
      email: "faisal@ziina.com",
      name: "Faisal Toukan",
      title: "CEO",
      linkedinUrl: null,
      verified: false,
      foundVia: "hunter",
    });

    const { findEmailForNamedContact } = await import("@/lib/integrations/contact-lookup");
    const result = await findEmailForNamedContact("https://www.ziina.com", "Faisal", "Toukan");

    expect(result?.foundVia).toBe("hunter");
    expect(apolloFindNamedMock).toHaveBeenCalledWith("https://www.ziina.com", "Faisal", "Toukan");
    expect(hunterFindNamedMock).toHaveBeenCalledWith("https://www.ziina.com", "Faisal", "Toukan");
  });
});

/**
 * Typed wrapper around the Hunter.io API, used to find a CEO/CTO email
 * address for a researched company when one wasn't supplied manually. This
 * is the only file that calls Hunter directly.
 *
 * Two entry points:
 * - `findExecutiveContact` — given just a domain, searches all known emails
 *   at that domain and returns the best executive-seniority match (used
 *   when no contact name was provided).
 * - `findEmailForNamedContact` — given a domain and a known first/last name,
 *   finds that specific person's email (used when a contact name was
 *   provided but not their email).
 */
import { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { IntegrationError } from "@/lib/integrations/errors";

const HUNTER_BASE_URL = "https://api.hunter.io/v2";
const EXECUTIVE_POSITION_KEYWORDS = ["ceo", "cto", "founder", "co-founder", "chief"];

const hunterEmailSchema = z.object({
  value: z.string().email(),
  type: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  seniority: z.string().nullable().optional(),
  linkedin: z.string().nullable().optional(),
});

const domainSearchResponseSchema = z.object({
  data: z.object({
    domain: z.string(),
    emails: z.array(hunterEmailSchema),
  }),
});

const emailFinderResponseSchema = z.object({
  data: z.object({
    email: z.string().email().nullable(),
    score: z.number().nullable().optional(),
    position: z.string().nullable().optional(),
    linkedin_url: z.string().nullable().optional(),
  }),
});

export interface HunterContact {
  email: string;
  name: string | null;
  title: string | null;
  linkedinUrl: string | null;
  verified: boolean;
}

function extractDomain(companyUrl: string): string {
  try {
    return new URL(companyUrl).hostname.replace(/^www\./, "");
  } catch {
    return companyUrl.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? companyUrl;
  }
}

function isExecutivePosition(position: string | null | undefined, seniority: string | null | undefined): boolean {
  const haystack = `${position ?? ""} ${seniority ?? ""}`.toLowerCase();
  return EXECUTIVE_POSITION_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/**
 * Finds the best executive-level (CEO/CTO/founder) email at a company's domain.
 * @param companyUrl - the company's homepage URL
 * @returns the best-matching executive contact, or null if none was found or the request failed
 */
export async function findExecutiveContact(companyUrl: string): Promise<HunterContact | null> {
  const domain = extractDomain(companyUrl);

  try {
    const url = new URL(`${HUNTER_BASE_URL}/domain-search`);
    url.searchParams.set("domain", domain);
    url.searchParams.set("api_key", env.HUNTER_API_KEY);
    url.searchParams.set("seniority", "executive");

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new IntegrationError(
        "hunter",
        `domain-search request failed with status ${response.status} for domain "${domain}"`,
      );
    }

    const json: unknown = await response.json();
    const parsed = domainSearchResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new IntegrationError(
        "hunter",
        `domain-search response failed schema validation for domain "${domain}": ${parsed.error.message}`,
      );
    }

    const executiveEmails = parsed.data.data.emails.filter((email) =>
      isExecutivePosition(email.position, email.seniority),
    );
    const best = (executiveEmails.length > 0 ? executiveEmails : parsed.data.data.emails)
      .slice()
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];

    if (!best) {
      return null;
    }

    return {
      email: best.value,
      name: [best.first_name, best.last_name].filter(Boolean).join(" ") || null,
      title: best.position ?? null,
      linkedinUrl: best.linkedin ?? null,
      verified: (best.confidence ?? 0) >= 50,
    };
  } catch (cause) {
    logger.warn("hunter domain-search failed, contact will need manual entry", {
      domain,
      cause: String(cause),
    });
    return null;
  }
}

/**
 * Finds the email address for a specific named person at a company's domain.
 * @param companyUrl - the company's homepage URL
 * @param firstName - the contact's first name
 * @param lastName - the contact's last name
 * @returns the found contact with verification confidence, or null if not found or the request failed
 */
export async function findEmailForNamedContact(
  companyUrl: string,
  firstName: string,
  lastName: string,
): Promise<HunterContact | null> {
  const domain = extractDomain(companyUrl);

  try {
    const url = new URL(`${HUNTER_BASE_URL}/email-finder`);
    url.searchParams.set("domain", domain);
    url.searchParams.set("first_name", firstName);
    url.searchParams.set("last_name", lastName);
    url.searchParams.set("api_key", env.HUNTER_API_KEY);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new IntegrationError(
        "hunter",
        `email-finder request failed with status ${response.status} for "${firstName} ${lastName}" at "${domain}"`,
      );
    }

    const json: unknown = await response.json();
    const parsed = emailFinderResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new IntegrationError(
        "hunter",
        `email-finder response failed schema validation: ${parsed.error.message}`,
      );
    }

    if (!parsed.data.data.email) {
      return null;
    }

    return {
      email: parsed.data.data.email,
      name: `${firstName} ${lastName}`,
      title: parsed.data.data.position ?? null,
      linkedinUrl: parsed.data.data.linkedin_url ?? null,
      verified: (parsed.data.data.score ?? 0) >= 50,
    };
  } catch (cause) {
    logger.warn("hunter email-finder failed, contact will need manual entry", {
      domain,
      firstName,
      lastName,
      cause: String(cause),
    });
    return null;
  }
}

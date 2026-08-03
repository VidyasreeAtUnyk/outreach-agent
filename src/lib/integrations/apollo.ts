/**
 * Typed wrapper around the Apollo.io API — the primary contact-lookup
 * provider (tried before Hunter — see
 * lib/integrations/contact-lookup.ts and
 * docs/decisions/06-apollo-alongside-hunter.md for why). This is the only
 * file that calls Apollo directly.
 *
 * APOLLO_API_KEY is optional: if unset, both entry points below return null
 * immediately, same as "not found," so contact-lookup.ts's fallback to
 * Hunter still works with only Hunter configured.
 *
 * Every call is metered against a per-cycle credit quota (90/cycle on the
 * plan in use) tracked in the `apollo_usage` table — see
 * docs/decisions/05-external-api-budgets.md. A credit is reserved
 * atomically before the request goes out; once a cycle's quota is
 * exhausted, both entry points return null rather than throwing, the same
 * as any other Apollo failure — contact-lookup.ts falls back to Hunter
 * regardless of why Apollo came back empty.
 *
 * Apollo's exact response shape — and whether an email comes back
 * "unlocked" vs. a masked placeholder like
 * "email_not_unlocked@domain.com" — depends on the plan/credits on the
 * API key in use. This wrapper treats a masked/placeholder email as
 * "not found" rather than saving garbage data to the contacts table.
 *
 * Two entry points, mirroring lib/integrations/hunter.ts:
 * - `findExecutiveContact` — searches for CEO/CTO/founder titles at a
 *   domain (used when no contact name was provided).
 * - `findEmailForNamedContact` — enriches a known first/last name at a
 *   domain to find their email (used when a contact name was provided
 *   but not their email).
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { IntegrationError } from "@/lib/integrations/errors";
import { createServiceClient } from "@/lib/supabase/service";
import type { ContactLookupResult } from "@/lib/integrations/contact";

const APOLLO_BASE_URL = "https://api.apollo.io/v1";
const EXECUTIVE_TITLES = [
  "CEO",
  "Chief Executive Officer",
  "CTO",
  "Chief Technology Officer",
  "Founder",
  "Co-Founder",
];

const apolloPersonSchema = z.object({
  email: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  email_status: z.string().nullable().optional(),
});

type ApolloPerson = z.infer<typeof apolloPersonSchema>;

const searchResponseSchema = z.object({
  people: z.array(apolloPersonSchema).optional(),
});

const matchResponseSchema = z.object({
  person: apolloPersonSchema.nullable().optional(),
});

interface CreditReservation {
  allowed: boolean;
  creditsUsed: number;
  creditBudget: number;
}

/** Atomically reserves one credit against the current cycle's quota. Never throws on exhaustion — returns allowed: false so the caller can skip the lookup gracefully. */
async function reserveCredit(): Promise<CreditReservation> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("increment_apollo_usage").single();

  if (error || !data) {
    logger.warn("failed to check Apollo credit budget, proceeding without metering this call", {
      error: error?.message,
    });
    return { allowed: true, creditsUsed: 0, creditBudget: 0 };
  }

  const row = data as { credits_used: number; credit_budget: number; allowed: boolean };
  return { allowed: row.allowed, creditsUsed: row.credits_used, creditBudget: row.credit_budget };
}

/** Releases a reservation that never reached Apollo (the request failed before any response). Best-effort — logged, not thrown, if it fails. */
async function releaseCredit(): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("decrement_apollo_usage");
  if (error) {
    logger.warn("failed to release an unused Apollo credit reservation", { error: error.message });
  }
}

/**
 * Reads the current cycle's Apollo credit usage without reserving a credit.
 * @param supabase - a request-scoped Supabase client (RLS allows any authenticated user to read this row)
 * @returns credits used this cycle, the per-cycle budget, and credits remaining
 */
export async function getApolloUsage(
  supabase: SupabaseClient,
): Promise<{ creditsUsed: number; creditBudget: number; remaining: number }> {
  const currentPeriod = new Date().toISOString().slice(0, 7);

  const { data, error } = await supabase
    .from("apollo_usage")
    .select("credits_used, credit_budget")
    .eq("period", currentPeriod)
    .maybeSingle();

  if (error) {
    logger.warn("failed to read Apollo usage", { error: error.message });
    return { creditsUsed: 0, creditBudget: 0, remaining: 0 };
  }

  // No row yet this cycle means nobody has looked up a contact since the cycle rolled over — full quota available.
  const creditsUsed = data?.credits_used ?? 0;
  const creditBudget = data?.credit_budget ?? 90;

  return { creditsUsed, creditBudget, remaining: Math.max(0, creditBudget - creditsUsed) };
}

function extractDomain(companyUrl: string): string {
  try {
    return new URL(companyUrl).hostname.replace(/^www\./, "");
  } catch {
    return companyUrl.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? companyUrl;
  }
}

/** Apollo returns a masked placeholder (e.g. "email_not_unlocked@domain.com") instead of throwing when the key's plan hasn't unlocked a real address — treat that the same as no email found. */
function isUsableEmail(email: string | null | undefined): email is string {
  return !!email && !email.toLowerCase().includes("not_unlocked");
}

function toContactLookupResult(person: ApolloPerson): ContactLookupResult | null {
  if (!isUsableEmail(person.email)) return null;

  return {
    email: person.email,
    name: [person.first_name, person.last_name].filter(Boolean).join(" ") || null,
    title: person.title ?? null,
    linkedinUrl: person.linkedin_url ?? null,
    verified: person.email_status === "verified",
    foundVia: "apollo",
  };
}

/**
 * Finds the best executive-level (CEO/CTO/founder) contact at a company's domain via Apollo's people search.
 * @param companyUrl - the company's homepage URL
 * @returns the best-matching executive contact, or null if not configured, budget exhausted, not found, or the request failed
 */
export async function findExecutiveContact(companyUrl: string): Promise<ContactLookupResult | null> {
  if (!env.APOLLO_API_KEY) return null;

  const domain = extractDomain(companyUrl);

  const reservation = await reserveCredit();
  if (!reservation.allowed) {
    logger.warn("apollo credit budget exhausted for this cycle, skipping lookup", {
      domain,
      creditsUsed: reservation.creditsUsed,
      creditBudget: reservation.creditBudget,
    });
    return null;
  }

  let response: Response;
  try {
    response = await fetch(`${APOLLO_BASE_URL}/mixed_people/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": env.APOLLO_API_KEY },
      body: JSON.stringify({
        q_organization_domains: domain,
        person_titles: EXECUTIVE_TITLES,
        per_page: 5,
      }),
    });
  } catch (cause) {
    await releaseCredit();
    logger.warn("apollo people search request failed, contact will need manual entry", {
      domain,
      cause: String(cause),
    });
    return null;
  }

  try {
    if (!response.ok) {
      throw new IntegrationError(
        "apollo",
        `people search failed with status ${response.status} for domain "${domain}"`,
      );
    }

    const json: unknown = await response.json();
    const parsed = searchResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new IntegrationError(
        "apollo",
        `people search response failed schema validation for domain "${domain}": ${parsed.error.message}`,
      );
    }

    const people = parsed.data.people ?? [];
    for (const person of people) {
      const contact = toContactLookupResult(person);
      if (contact) return contact;
    }
    return null;
  } catch (cause) {
    // A response was received (even if unusable), so the credit was
    // actually spent — do not release it.
    logger.warn("apollo people search failed, contact will need manual entry", {
      domain,
      cause: String(cause),
    });
    return null;
  }
}

/**
 * Finds the email address for a specific named person at a company's domain via Apollo's people-match (enrichment) endpoint.
 * @param companyUrl - the company's homepage URL
 * @param firstName - the contact's first name
 * @param lastName - the contact's last name
 * @returns the found contact with verification status, or null if not configured, budget exhausted, not found, or the request failed
 */
export async function findEmailForNamedContact(
  companyUrl: string,
  firstName: string,
  lastName: string,
): Promise<ContactLookupResult | null> {
  if (!env.APOLLO_API_KEY) return null;

  const domain = extractDomain(companyUrl);

  const reservation = await reserveCredit();
  if (!reservation.allowed) {
    logger.warn("apollo credit budget exhausted for this cycle, skipping lookup", {
      domain,
      firstName,
      lastName,
      creditsUsed: reservation.creditsUsed,
      creditBudget: reservation.creditBudget,
    });
    return null;
  }

  let response: Response;
  try {
    response = await fetch(`${APOLLO_BASE_URL}/people/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": env.APOLLO_API_KEY },
      body: JSON.stringify({ first_name: firstName, last_name: lastName, domain }),
    });
  } catch (cause) {
    await releaseCredit();
    logger.warn("apollo people match request failed, contact will need manual entry", {
      domain,
      firstName,
      lastName,
      cause: String(cause),
    });
    return null;
  }

  try {
    if (!response.ok) {
      throw new IntegrationError(
        "apollo",
        `people match failed with status ${response.status} for "${firstName} ${lastName}" at "${domain}"`,
      );
    }

    const json: unknown = await response.json();
    const parsed = matchResponseSchema.safeParse(json);

    if (!parsed.success) {
      throw new IntegrationError(
        "apollo",
        `people match response failed schema validation: ${parsed.error.message}`,
      );
    }

    if (!parsed.data.person) return null;
    return toContactLookupResult(parsed.data.person);
  } catch (cause) {
    logger.warn("apollo people match failed, contact will need manual entry", {
      domain,
      firstName,
      lastName,
      cause: String(cause),
    });
    return null;
  }
}

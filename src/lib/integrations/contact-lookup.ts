/**
 * Orchestrates contact/email lookup across configured providers: tries
 * Apollo first, then falls back to Hunter if Apollo isn't configured or
 * doesn't find a usable email. See
 * docs/decisions/06-apollo-alongside-hunter.md for why Apollo goes first.
 * lib/agent/research.ts calls this module, not apollo.ts/hunter.ts
 * directly, so it doesn't need to know how many providers exist or in
 * what order they're tried.
 *
 * Both providers are individually optional (missing API key => that
 * provider returns null immediately). If neither is configured, or
 * neither finds a match, this returns null and the contact is flagged for
 * manual entry in the review UI — consistent with every other best-effort
 * step in the research pipeline (see docs/architecture.md).
 */
import * as apollo from "@/lib/integrations/apollo";
import * as hunter from "@/lib/integrations/hunter";
import type { ContactLookupResult } from "@/lib/integrations/contact";

/**
 * Finds the best executive-level (CEO/CTO/founder) contact at a company's domain, trying Apollo then Hunter.
 * @param companyUrl - the company's homepage URL
 * @returns the best-matching executive contact, or null if no configured provider found one
 */
export async function findExecutiveContact(companyUrl: string): Promise<ContactLookupResult | null> {
  const fromApollo = await apollo.findExecutiveContact(companyUrl);
  if (fromApollo) return fromApollo;

  return hunter.findExecutiveContact(companyUrl);
}

/**
 * Finds the email address for a specific named person at a company's domain, trying Apollo then Hunter.
 * @param companyUrl - the company's homepage URL
 * @param firstName - the contact's first name
 * @param lastName - the contact's last name
 * @returns the found contact, or null if no configured provider found one
 */
export async function findEmailForNamedContact(
  companyUrl: string,
  firstName: string,
  lastName: string,
): Promise<ContactLookupResult | null> {
  const fromApollo = await apollo.findEmailForNamedContact(companyUrl, firstName, lastName);
  if (fromApollo) return fromApollo;

  return hunter.findEmailForNamedContact(companyUrl, firstName, lastName);
}

/**
 * Shared shape returned by every contact/email-lookup provider (Hunter,
 * Apollo, ...), so lib/integrations/contact-lookup.ts can try them in order
 * without each provider's wrapper needing to know about the others. Kept in
 * its own file (no logic, no dependencies) so hunter.ts and apollo.ts can
 * both import the type without either depending on the other.
 */

export interface ContactLookupResult {
  email: string;
  name: string | null;
  title: string | null;
  linkedinUrl: string | null;
  verified: boolean;
  /** Which provider actually found this contact — persisted as contacts.found_via. */
  foundVia: "apollo" | "hunter";
}

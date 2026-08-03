import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges class names, resolving conflicting Tailwind utility classes (e.g. `p-2` vs `p-4`) in favor of the last one. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Extracts the bare hostname (no "www.", no scheme, no path) from a URL,
 * falling back to best-effort string parsing if the URL constructor
 * rejects the input. Used to identify a company by its domain across
 * lib/integrations/{hunter,apollo}.ts and lib/agent/discover.ts.
 */
export function extractDomain(companyUrl: string): string {
  try {
    return new URL(companyUrl).hostname.replace(/^www\./, "");
  } catch {
    return companyUrl.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] ?? companyUrl;
  }
}

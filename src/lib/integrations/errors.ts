/**
 * Shared error type for every lib/integrations/* wrapper, so callers in
 * lib/agent/* can catch one error class regardless of which external API
 * failed, log which service and step failed, and decide whether to
 * continue with partial data (see docs/architecture.md's error-handling
 * philosophy) or abort.
 */

export type IntegrationServiceName = "openai" | "tavily" | "hunter" | "apollo" | "resend";

/** Machine-checkable reason, for callers that need to branch on the failure (e.g. api-utils.ts mapping budget exhaustion or an upstream rate limit to a 429). */
export type IntegrationErrorCode = "budget_exhausted" | "rate_limited";

export class IntegrationError extends Error {
  readonly service: IntegrationServiceName;
  readonly code?: IntegrationErrorCode;
  override readonly cause?: unknown;

  constructor(
    service: IntegrationServiceName,
    message: string,
    options?: { cause?: unknown; code?: IntegrationErrorCode },
  ) {
    super(`[${service}] ${message}`);
    this.name = "IntegrationError";
    this.service = service;
    this.cause = options?.cause;
    this.code = options?.code;
  }
}

/**
 * Shared error type for every lib/integrations/* wrapper, so callers in
 * lib/agent/* can catch one error class regardless of which external API
 * failed, log which service and step failed, and decide whether to
 * continue with partial data (see docs/architecture.md's error-handling
 * philosophy) or abort.
 */

export type IntegrationServiceName = "openai" | "tavily" | "hunter" | "resend";

export class IntegrationError extends Error {
  readonly service: IntegrationServiceName;
  override readonly cause?: unknown;

  constructor(service: IntegrationServiceName, message: string, cause?: unknown) {
    super(`[${service}] ${message}`);
    this.name = "IntegrationError";
    this.service = service;
    this.cause = cause;
  }
}

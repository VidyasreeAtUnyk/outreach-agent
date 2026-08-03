/**
 * Phase 2 stub. Nothing in this codebase calls `sendEmail` — approval and
 * sending are deliberately kept as separate, manually-triggered steps in
 * Phase 1 (the human copies the approved email and sends it from Gmail).
 * See docs/decisions/04-review-before-send.md for the full reasoning,
 * including why wiring this up now (before deliverability/domain-auth
 * setup) would actively hurt cold-email deliverability.
 *
 * This function exists so Phase 2 has a settled interface to implement
 * against — do not remove it as "unused code" and do not call it.
 */
import type { Draft } from "@/types";

export interface SendResult {
  messageId: string;
  sentAt: string;
}

/**
 * Sends an approved draft via Resend. Not implemented in Phase 1.
 * @param _draft - the approved draft to send
 * @returns never — always throws
 * @throws always — see docs/decisions/04-review-before-send.md
 */
export async function sendEmail(_draft: Draft): Promise<SendResult> {
  throw new Error(
    "sendEmail is not implemented in Phase 1 — see docs/decisions/04-review-before-send.md. Approve the draft and send it manually from Gmail instead.",
  );
}

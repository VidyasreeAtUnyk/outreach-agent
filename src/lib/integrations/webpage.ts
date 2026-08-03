/**
 * Fetches a company's own homepage/about page as plain text for research
 * step 2 (see docs/architecture.md). Unlike the Tavily/Hunter/OpenAI
 * wrappers this has no API key or provider SDK — it's a direct fetch — but
 * it lives here rather than inline in lib/agent/research.ts for the same
 * reason those do: one place responsible for the I/O and its error
 * handling, validated before use.
 */
import { logger } from "@/lib/logger";

const FETCH_TIMEOUT_MS = 8_000;
const MAX_CONTENT_LENGTH = 6_000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fetches a URL and returns its visible text content, truncated to a size
 * reasonable for an LLM prompt.
 * @param url - the page to fetch
 * @returns the extracted plain text, or null if the fetch failed, timed out, or returned a non-HTML/error response
 */
export async function fetchPageText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "OutreachAgent/1.0 (company research)" },
    });

    if (!response.ok) {
      logger.warn("homepage fetch returned non-ok status, continuing without it", {
        url,
        status: response.status,
      });
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      return null;
    }

    const html = await response.text();
    return stripHtml(html).slice(0, MAX_CONTENT_LENGTH);
  } catch (cause) {
    logger.warn("homepage fetch failed, continuing without it", { url, cause: String(cause) });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

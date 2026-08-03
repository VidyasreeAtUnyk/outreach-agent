/**
 * Orchestrates the full company research pipeline described in
 * docs/architecture.md: web search for product/features, a direct homepage
 * fetch, web search for hiring signals, web search for funding news, GPT-4o
 * synthesis of all of that into a structured company profile, a Hunter.io
 * lookup for a CEO/CTO email if one wasn't supplied, and finally persisting
 * the result to Supabase.
 *
 * Every step before synthesis is best-effort: search or fetch failures are
 * caught, logged, and recorded in `incompleteSteps` rather than aborting
 * the pipeline, because a single flaky request shouldn't block researching
 * an otherwise-reachable company. Synthesis itself is the one step allowed
 * to throw, since a company record with no synthesized understanding isn't
 * useful to save.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { tavilySearch } from "@/lib/integrations/tavily";
import { fetchPageText } from "@/lib/integrations/webpage";
import { runJsonCompletion } from "@/lib/integrations/openai";
import { findExecutiveContact, findEmailForNamedContact } from "@/lib/integrations/hunter";
import { PROMPTS } from "@/lib/prompts";
import { logger } from "@/lib/logger";
import { CONTACT_SOURCE, INDUSTRY, COMPANY_SIZE, COMPANY_STAGE } from "@/lib/constants";
import { mapCompanyRow, mapContactRow } from "@/lib/supabase/mappers";
import type { Company, Contact } from "@/types";

const synthesisResponseSchema = z.object({
  companyName: z.string().min(1),
  description: z.string(),
  painPoint: z.string().nullable(),
  techSignals: z.array(z.string()),
  hiringSignals: z.array(z.string()),
  recentNews: z.string().nullable(),
  stage: z.enum(Object.values(COMPANY_STAGE) as [string, ...string[]]).nullable(),
  size: z.enum(Object.values(COMPANY_SIZE) as [string, ...string[]]).nullable(),
  industry: z.enum(Object.values(INDUSTRY) as [string, ...string[]]).nullable(),
  urgencyNotes: z.string().nullable(),
});

export interface ResearchCompanyParams {
  companyUrl: string;
  contactName?: string;
  contactTitle?: string;
  userId: string;
  supabase: SupabaseClient;
}

export interface ResearchCompanyOutput {
  company: Company;
  contact: Contact | null;
  incompleteSteps: string[];
}

function deriveFallbackName(companyUrl: string): string {
  try {
    return new URL(companyUrl).hostname.replace(/^www\./, "").split(".")[0] ?? companyUrl;
  } catch {
    return companyUrl;
  }
}

/**
 * Runs the full research pipeline for one company and persists the result.
 * @param params - the company URL, optional known contact details, and the authenticated Supabase client/user to save under
 * @returns the saved company and contact rows, plus which research steps were skipped due to upstream failures
 * @throws if the OpenAI synthesis step itself fails — every earlier step degrades gracefully instead of throwing
 */
export async function researchCompany(params: ResearchCompanyParams): Promise<ResearchCompanyOutput> {
  const { companyUrl, contactName, contactTitle, userId, supabase } = params;
  const incompleteSteps: string[] = [];
  const fallbackName = deriveFallbackName(companyUrl);

  const [featureResults, jobResults, fundingResults, homepageText] = await Promise.all([
    tavilySearch(`${fallbackName} UAE product features`),
    tavilySearch(`${fallbackName} jobs hiring 2025`),
    tavilySearch(`${fallbackName} funding news 2024 2025`),
    fetchPageText(companyUrl),
  ]);

  if (featureResults.length === 0) incompleteSteps.push("product_feature_search");
  if (jobResults.length === 0) incompleteSteps.push("hiring_search");
  if (fundingResults.length === 0) incompleteSteps.push("funding_news_search");
  if (!homepageText) incompleteSteps.push("homepage_fetch");

  const synthesisInput = JSON.stringify({
    companyUrlOrFallbackName: fallbackName,
    homepageContent: homepageText ?? "unavailable",
    productFeatureSearchResults: featureResults.map((r) => ({ title: r.title, content: r.content })),
    hiringSearchResults: jobResults.map((r) => ({ title: r.title, content: r.content })),
    fundingNewsSearchResults: fundingResults.map((r) => ({ title: r.title, content: r.content })),
  });

  const synthesis = await runJsonCompletion({
    systemPrompt: PROMPTS.RESEARCH_SYNTHESIS,
    userContent: synthesisInput,
    schema: synthesisResponseSchema,
    label: "research-synthesis",
  });

  const { data: companyRow, error: companyError } = await supabase
    .from("companies")
    .insert({
      user_id: userId,
      name: synthesis.companyName,
      url: companyUrl,
      industry: synthesis.industry,
      size: synthesis.size,
      stage: synthesis.stage,
      description: synthesis.description,
      pain_point: synthesis.painPoint,
      tech_signals: synthesis.techSignals,
      hiring_signals: synthesis.hiringSignals,
      recent_news: synthesis.recentNews,
    })
    .select()
    .single();

  if (companyError || !companyRow) {
    logger.error("failed to persist researched company", { companyUrl, error: companyError?.message });
    throw new Error(`Failed to save researched company: ${companyError?.message ?? "unknown error"}`);
  }

  const company = mapCompanyRow(companyRow);

  let contact: Contact | null = null;
  try {
    if (contactName) {
      const [firstName, ...rest] = contactName.trim().split(/\s+/);
      const lastName = rest.join(" ");
      const found = firstName && lastName ? await findEmailForNamedContact(companyUrl, firstName, lastName) : null;

      const { data: contactRow, error: contactError } = await supabase
        .from("contacts")
        .insert({
          user_id: userId,
          company_id: company.id,
          name: contactName,
          title: contactTitle ?? found?.title ?? null,
          email: found?.email ?? null,
          linkedin_url: found?.linkedinUrl ?? null,
          email_verified: found?.verified ?? false,
          found_via: found ? CONTACT_SOURCE.HUNTER : CONTACT_SOURCE.MANUAL,
        })
        .select()
        .single();

      if (contactError || !contactRow) {
        throw new Error(contactError?.message ?? "unknown error");
      }
      contact = mapContactRow(contactRow);
      if (!found) incompleteSteps.push("contact_email_lookup");
    } else {
      const found = await findExecutiveContact(companyUrl);
      if (found) {
        const { data: contactRow, error: contactError } = await supabase
          .from("contacts")
          .insert({
            user_id: userId,
            company_id: company.id,
            name: found.name ?? "Unknown",
            title: found.title,
            email: found.email,
            linkedin_url: found.linkedinUrl,
            email_verified: found.verified,
            found_via: CONTACT_SOURCE.HUNTER,
          })
          .select()
          .single();

        if (contactError || !contactRow) {
          throw new Error(contactError?.message ?? "unknown error");
        }
        contact = mapContactRow(contactRow);
      } else {
        incompleteSteps.push("contact_discovery");
      }
    }
  } catch (cause) {
    logger.warn("failed to save contact, company research still succeeded", {
      companyId: company.id,
      cause: String(cause),
    });
    incompleteSteps.push("contact_persistence");
  }

  return { company, contact, incompleteSteps };
}

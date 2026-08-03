/**
 * Vidyasree's applicant profile. Fed into the drafting and scoring prompts
 * (see lib/prompts.ts) so generated emails are written in her actual voice
 * and background, not generic AI-applicant boilerplate.
 */

export const PROFILE = {
  name: "Vidyasree Natarajan",
  title: "Senior AI Engineer",
  location: "Dubai, UAE",
  yearsExperience: "7+",
  github: "https://github.com/VidyasreeAtUnyk",
  email: "vidya301096@gmail.com",
  phone: "+971 563 914 154",

  coreStrengths: [
    "Production-grade agentic AI systems — tool-calling, guardrails in code not prompts",
    "React 18, Next.js (SSR/SSG/ISR), TypeScript — 7+ years production",
    "Supabase — RLS, Realtime, Edge Functions, auth middleware",
    "Full test coverage — Jest, Playwright, live LLM eval scenarios",
    "Ships fast, documents decisions before writing code, finds bugs in manual testing",
  ],

  background: [
    "Designory (Omnicom Group), Chicago — Senior Frontend Engineer, 2022–2024",
    "Credit One Bank, Nevada — Web Developer, 2021",
    "MS Management Information Systems, Northern Illinois University",
  ],

  voice: [
    "Direct and specific — no buzzwords",
    "Technical without being academic",
    "Confident without being arrogant",
    "Shows she looked at their company, not just sent a template",
    "Short — under 150 words for cold emails",
  ],

  neverSay: [
    "I hope this finds you well",
    "I am reaching out",
    "Please find attached",
    "synergy",
    "leverage",
    "passionate about",
    "excited to",
    "I would love the opportunity",
    "Please do not hesitate to contact me",
  ],
} as const;

export type Profile = typeof PROFILE;

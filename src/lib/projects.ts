/**
 * Vidyasree's portfolio project registry. This is the core input to
 * lib/agent/match.ts, which scores each project against a researched
 * company's industry and pain points to pick the strongest proof point for
 * a given cold email. See docs/architecture.md for the scoring weights.
 */

export interface Project {
  id: string;
  name: string;
  subtitle: string;
  github: string | null;
  demo: string | null;
  demoCredentials: string | null;
  stack: readonly string[];
  relevantIndustries: readonly string[];
  relevantPainPoints: readonly string[];
  headline: string;
  technicalDepth: string;
}

export const PROJECTS: readonly Project[] = [
  {
    id: "lead-follow-up-agent",
    name: "Lead Follow-Up Agent",
    subtitle: "Agentic AI System · Guardrail-Enforced · Real Estate",
    github: "https://github.com/VidyasreeAtUnyk/real-estate-lead-agent",
    demo: null,
    demoCredentials: null,
    stack: ["TypeScript", "Node.js", "OpenAI Function Calling", "SQLite", "Zod"],
    relevantIndustries: ["proptech", "real_estate", "fintech", "sales", "crm", "b2b"],
    relevantPainPoints: ["lead_management", "sales_automation", "follow_up", "agent_ops"],
    headline:
      "Autonomous lead follow-up agent — OpenAI function calling, 10 typed tools, guardrails enforced in code not prompts, fully resumable",
    technicalDepth:
      "tool-calling orchestration, code-enforced guardrails, retry/backoff, idempotent locking, provider-agnostic (OpenAI → Gemini swap with zero guardrail changes)",
  },
  {
    id: "approval-engine",
    name: "Approval Engine",
    subtitle: "Enterprise Workflow Platform · Config-Driven · Built in <48h",
    github: "https://github.com/VidyasreeAtUnyk/mal-approval-engine",
    demo: "https://mal-approval-engine.vercel.app",
    demoCredentials: "employee@test.com / manager@test.com / admin@test.com · Test1234!",
    stack: ["Next.js 14", "TypeScript", "Tailwind", "Supabase", "OpenAI API", "Playwright"],
    relevantIndustries: ["enterprise", "hr_tech", "operations", "saas", "government", "finance"],
    relevantPainPoints: [
      "workflow_automation",
      "approval_processes",
      "ops_efficiency",
      "internal_tools",
    ],
    headline:
      "Config-driven approval engine built in under 48h — 101 tests, 100 Lighthouse accessibility, RLS on every table",
    technicalDepth:
      "config-driven architecture, Supabase RLS + Realtime, auth middleware, audit trail, idempotency, rate limiting",
  },
  {
    id: "zakat-calculator",
    name: "Zakat Calculator",
    subtitle: "Fintech · PWA · AI-Native",
    github: "https://github.com/VidyasreeAtUnyk/zakat-calculator",
    demo: "https://zakat-calculator-ruby.vercel.app",
    demoCredentials: null,
    stack: ["Next.js 14", "TypeScript", "Tailwind", "PWA", "Playwright"],
    relevantIndustries: ["fintech", "islamic_finance", "consumer", "mobile"],
    relevantPainPoints: ["financial_tools", "mobile_first", "pwa", "consumer_product"],
    headline:
      "99/100/100/100 Lighthouse, 88 unit + 34 Playwright E2E tests, live gold price API, PWA with offline fallback",
    technicalDepth:
      "PWA, service workers, offline-first, live API integration, comprehensive test coverage",
  },
  {
    id: "social-support-portal",
    name: "Social Support Portal",
    subtitle: "Arabic RTL · AI Writing Assistant · Government",
    github: "https://github.com/VidyasreeAtUnyk/social-support-portal",
    demo: "https://social-support-portal-iota.vercel.app",
    demoCredentials: null,
    stack: ["Next.js", "TypeScript", "Material UI", "Redux Toolkit", "OpenAI API"],
    relevantIndustries: [
      "government",
      "public_sector",
      "healthcare",
      "social_impact",
      "uae_specific",
    ],
    relevantPainPoints: [
      "arabic_rtl",
      "multi_step_forms",
      "government_portals",
      "accessibility",
    ],
    headline:
      "Full Arabic RTL implementation, AI writing assistant, multi-step wizard with validation, custom design system",
    technicalDepth:
      "Arabic RTL, react-i18next, OpenAI API with offline fallback, React Hook Form + Yup, Redux Toolkit",
  },
  {
    id: "sales-dashboard",
    name: "Sales Analytics & AI Forecasting Dashboard",
    subtitle: "Internal Tool · AI Recommendations · Automated Reporting",
    github: null,
    demo: null,
    demoCredentials: "Demo available on request",
    stack: ["React", "OpenAI API", "Email automation", "Data visualization"],
    relevantIndustries: ["b2b", "saas", "sales", "retail", "distribution"],
    relevantPainPoints: [
      "sales_intelligence",
      "reporting_automation",
      "forecasting",
      "business_intelligence",
    ],
    headline:
      "Actively used by non-technical business stakeholders — AI-generated sales forecasts, overdue alerts, automated weekly reports",
    technicalDepth:
      "OpenAI API integration, email automation, data visualisation, non-technical user UX",
  },
];

export type ProjectId = Project["id"];

/**
 * Looks up a project by id.
 * @param id - a project id, expected to be one produced by lib/agent/match.ts
 * @returns the matching project
 * @throws if no project with that id exists in the registry
 */
export function getProjectById(id: string): Project {
  const project = PROJECTS.find((candidate) => candidate.id === id);
  if (!project) {
    throw new Error(`Unknown project id: ${id}`);
  }
  return project;
}

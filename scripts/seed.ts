/**
 * Seeds realistic sample data for local development: 3 companies at
 * different confidence levels (Bayut — high-confidence proptech match,
 * Ziina — medium-confidence fintech match, a government entity — low-
 * confidence "skip" example), 2 drafts (one approved, one pending), and
 * 1 reply on the approved draft. Uses the service-role client since it
 * runs outside any authenticated request context — see
 * lib/supabase/service.ts for why that's the one legitimate use of that
 * client.
 *
 * Run with: npm run seed
 * Requires SEED_USER_ID (the Supabase auth user id to seed data for) —
 * if unset, seeds the first user found in the project instead.
 */
import "dotenv/config";
import { createServiceClient } from "../src/lib/supabase/service";

async function resolveSeedUserId(supabase: ReturnType<typeof createServiceClient>): Promise<string> {
  if (process.env.SEED_USER_ID) {
    return process.env.SEED_USER_ID;
  }

  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error || !data.users[0]) {
    throw new Error(
      "No SEED_USER_ID set and no existing Supabase user found. Sign up at /login first, or set SEED_USER_ID in .env.local.",
    );
  }
  return data.users[0].id;
}

async function main() {
  const supabase = createServiceClient();
  const userId = await resolveSeedUserId(supabase);

  console.log(`Seeding data for user ${userId}...`);

  const { data: bayut, error: bayutError } = await supabase
    .from("companies")
    .insert({
      user_id: userId,
      name: "Bayut",
      url: "https://www.bayut.com",
      industry: "proptech",
      size: "scaleup",
      stage: "series-b",
      location: "Dubai, UAE",
      description:
        "Bayut is the UAE's leading property portal, connecting buyers, sellers, and renters with listings across the Emirates.",
      pain_point:
        "Scaling personalized lead follow-up for property inquiries across a growing volume of listings, with a lean engineering team.",
      tech_signals: ["React", "Node.js", "Elasticsearch", "AWS"],
      hiring_signals: ["Senior Backend Engineer", "AI/ML Engineer", "Platform Engineer"],
      recent_news: "Continued expansion of its AI-powered property recommendation features in 2025.",
    })
    .select()
    .single();
  if (bayutError || !bayut) throw new Error(`Failed to seed Bayut: ${bayutError?.message}`);

  const { data: ziina, error: ziinaError } = await supabase
    .from("companies")
    .insert({
      user_id: userId,
      name: "Ziina",
      url: "https://www.ziina.com",
      industry: "fintech",
      size: "startup",
      stage: "series-a",
      location: "Dubai, UAE",
      description:
        "Ziina is a UAE fintech offering peer-to-peer payments and business payment tools via a mobile app.",
      pain_point:
        "Building trust and financial-tooling depth as they expand from consumer P2P payments into business features.",
      tech_signals: ["React Native", "Node.js", "PostgreSQL"],
      hiring_signals: ["Product Engineer", "Mobile Engineer"],
      recent_news: "Raised a Series A round in 2024 to expand business payment products.",
    })
    .select()
    .single();
  if (ziinaError || !ziina) throw new Error(`Failed to seed Ziina: ${ziinaError?.message}`);

  const { data: govEntity, error: govError } = await supabase
    .from("companies")
    .insert({
      user_id: userId,
      name: "Emirates Social Services Authority",
      url: "https://www.example-gov.ae",
      industry: "government",
      size: "enterprise",
      stage: "public",
      location: "Abu Dhabi, UAE",
      description:
        "A UAE government entity administering social support applications and benefits for residents.",
      pain_point: null,
      tech_signals: [],
      hiring_signals: [],
      recent_news: null,
    })
    .select()
    .single();
  if (govError || !govEntity) throw new Error(`Failed to seed government entity: ${govError?.message}`);

  const { data: bayutContact, error: bayutContactError } = await supabase
    .from("contacts")
    .insert({
      user_id: userId,
      company_id: bayut.id,
      name: "Haider Ali Khan",
      title: "CEO",
      email: "haider@bayut.example.com",
      email_verified: true,
      found_via: "hunter",
    })
    .select()
    .single();
  if (bayutContactError || !bayutContact) {
    throw new Error(`Failed to seed Bayut contact: ${bayutContactError?.message}`);
  }

  const { data: ziinaContact, error: ziinaContactError } = await supabase
    .from("contacts")
    .insert({
      user_id: userId,
      company_id: ziina.id,
      name: "Faisal Toukan",
      title: "CEO",
      email: "faisal@ziina.example.com",
      email_verified: false,
      found_via: "manual",
    })
    .select()
    .single();
  if (ziinaContactError || !ziinaContact) {
    throw new Error(`Failed to seed Ziina contact: ${ziinaContactError?.message}`);
  }

  const { data: bayutDraft, error: bayutDraftError } = await supabase
    .from("drafts")
    .insert({
      user_id: userId,
      company_id: bayut.id,
      contact_id: bayutContact.id,
      subject: "A note on Bayut's lead follow-up at scale",
      body: "Haider,\n\nBayut's listing volume means every inbound lead needs fast, personalized follow-up — easy to say, hard to keep consistent as the team grows.\n\nI'm Vidyasree, a Senior AI Engineer who built an autonomous lead follow-up agent for real estate: OpenAI function calling, 10 typed tools, guardrails enforced in code rather than prompts, fully resumable.\n\nHappy to walk through the architecture on a 15 minute call.\n\nVidyasree Natarajan\nhttps://github.com/VidyasreeAtUnyk",
      project_matched: "lead-follow-up-agent",
      match_reasoning:
        '"Lead Follow-Up Agent" was selected because industry (proptech) matches this project\'s target industries, and the company\'s pain point overlaps with what this project demonstrates.',
      demo_url: null,
      confidence_score: 9,
      confidence_reason:
        "Strong industry fit (proptech), a clearly articulated lead-management pain point, active engineering hiring, and a scaleup size that fits direct executive outreach well.",
      needs_demo_customisation: true,
      customisation_notes:
        "No live demo available for this project — lead with the GitHub repo and offer a live walkthrough on the call.",
      status: "approved",
      approved_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (bayutDraftError || !bayutDraft) throw new Error(`Failed to seed Bayut draft: ${bayutDraftError?.message}`);

  const { error: ziinaDraftError } = await supabase.from("drafts").insert({
    user_id: userId,
    company_id: ziina.id,
    contact_id: ziinaContact.id,
    subject: "Ziina's move into business payments",
    body: "Faisal,\n\nZiina's expansion from P2P into business payments raises the bar on financial-tooling depth and trust.\n\nI'm Vidyasree, a Senior AI Engineer — I built a Zakat calculator with a live gold-price API, 99+ Lighthouse scores across the board, and full offline PWA support, all fintech-grade.\n\nWorth a 15 minute call to see if it's relevant to what you're building?\n\nVidyasree Natarajan\nhttps://github.com/VidyasreeAtUnyk",
    project_matched: "zakat-calculator",
    match_reasoning:
      '"Zakat Calculator" was selected because industry (fintech) matches this project\'s target industries.',
    demo_url: "https://zakat-calculator-ruby.vercel.app",
    confidence_score: 6,
    confidence_reason:
      "Reasonable fintech fit and a working live demo, but the pain point is less sharply defined than the top match, and the project's Islamic-finance framing is a partial rather than exact fit for a payments company.",
    needs_demo_customisation: false,
    customisation_notes: null,
    status: "pending",
  });
  if (ziinaDraftError) throw new Error(`Failed to seed Ziina draft: ${ziinaDraftError.message}`);

  const { error: govDraftError } = await supabase.from("drafts").insert({
    user_id: userId,
    company_id: govEntity.id,
    contact_id: null,
    subject: "Draft not recommended — low confidence match",
    body: "This company had no identifiable pain point or hiring signal in the research pipeline, so this draft is a placeholder illustrating the confidence score's 'skip' recommendation rather than a real send candidate.",
    project_matched: "social-support-portal",
    match_reasoning:
      "No strong signal match found; \"Social Support Portal\" was selected as the closest available fit by default.",
    demo_url: "https://social-support-portal-iota.vercel.app",
    confidence_score: 3,
    confidence_reason:
      "No pain point or hiring signal could be identified from available research, and large government entities typically hire through formal procurement rather than direct executive outreach.",
    needs_demo_customisation: true,
    customisation_notes: "Low confidence — consider skipping this application rather than customising the demo.",
    status: "pending",
  });
  if (govDraftError) throw new Error(`Failed to seed government entity draft: ${govDraftError.message}`);

  const { error: replyError } = await supabase.from("replies").insert({
    user_id: userId,
    draft_id: bayutDraft.id,
    received_at: new Date().toISOString(),
    body: "Thanks for reaching out — this is interesting, can you share more about the guardrail approach? Happy to do a call next week.",
    sentiment: "positive",
    suggested_response:
      "Glad it's useful — the guardrails are enforced in code (not just prompt instructions), so the agent can't take an action outside its allowed tool set regardless of what the model outputs. Would Tuesday or Wednesday afternoon work for a 15 minute call?",
    status: "unread",
  });
  if (replyError) throw new Error(`Failed to seed reply: ${replyError.message}`);

  console.log("Seed complete:");
  console.log(`  Companies: Bayut (${bayut.id}), Ziina (${ziina.id}), ${govEntity.name} (${govEntity.id})`);
  console.log(`  Drafts: Bayut (approved), Ziina (pending), ${govEntity.name} (pending, low confidence)`);
  console.log("  Replies: 1 positive reply on the Bayut draft");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

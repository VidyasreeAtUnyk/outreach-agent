/**
 * Populates placeholder environment variables before any test module
 * imports src/lib/env.ts (directly or transitively via lib/integrations/*),
 * since that module validates and throws at import time. Tests never make
 * real network calls to these services — every integration call is mocked
 * at the call site.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.OPENAI_API_KEY ??= "sk-test-key";
process.env.TAVILY_API_KEY ??= "test-tavily-key";
process.env.HUNTER_API_KEY ??= "test-hunter-key";

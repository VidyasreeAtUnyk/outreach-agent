/**
 * Next.js config. The one non-default piece is the CSP (and a few other
 * security headers) applied to every route — this app never needs inline
 * third-party scripts or cross-origin frames, so the policy is deliberately
 * tight rather than permissive-by-default.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js needs 'unsafe-inline' for its own injected runtime scripts/styles.
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self' ${supabaseUrl}`.trim(),
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;

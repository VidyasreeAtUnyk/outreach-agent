/**
 * GET /api/health
 * Unauthenticated liveness check, excluded from the auth middleware
 * (src/middleware.ts) so uptime monitoring doesn't need a session.
 */
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok" });
}

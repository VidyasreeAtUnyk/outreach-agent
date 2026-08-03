"use client";

/**
 * Shared body for every route segment's error.tsx. Each segment still needs
 * its own error.tsx file (Next.js requires that to scope the boundary to
 * that segment), but they all render this so the UI and logging stay
 * consistent instead of copy-pasted per route.
 */
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

export function RouteError({
  error,
  reset,
  routeLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  routeLabel: string;
}) {
  useEffect(() => {
    logger.error(`${routeLabel} route error`, { message: error.message, digest: error.digest });
  }, [error, routeLabel]);

  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed p-10 text-center">
      <h2 className="text-lg font-semibold">This page couldn&apos;t load.</h2>
      <p className="max-w-md text-sm text-muted-foreground">{error.message || "An unexpected error occurred."}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}

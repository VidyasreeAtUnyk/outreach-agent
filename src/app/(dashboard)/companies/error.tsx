"use client";

import { RouteError } from "@/components/layout/RouteError";

export default function CompaniesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} routeLabel="companies" />;
}

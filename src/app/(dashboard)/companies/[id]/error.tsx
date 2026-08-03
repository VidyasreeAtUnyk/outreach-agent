"use client";

import { RouteError } from "@/components/layout/RouteError";

export default function CompanyDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} routeLabel="company detail" />;
}

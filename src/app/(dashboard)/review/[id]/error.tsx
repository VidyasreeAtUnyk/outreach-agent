"use client";

import { RouteError } from "@/components/layout/RouteError";

export default function ReviewDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} routeLabel="review detail" />;
}

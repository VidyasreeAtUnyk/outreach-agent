import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges class names, resolving conflicting Tailwind utility classes (e.g. `p-2` vs `p-4`) in favor of the last one. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

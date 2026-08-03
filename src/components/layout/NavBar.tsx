"use client";

/**
 * Top navigation for the authenticated dashboard area: links to the four
 * main pages and a sign-out control.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/constants";

const NAV_LINKS = [
  { href: ROUTES.HOME, label: "Dashboard" },
  { href: ROUTES.RESEARCH, label: "Research" },
  { href: ROUTES.REVIEW, label: "Review" },
  { href: ROUTES.TRACKER, label: "Tracker" },
] as const;

export function NavBar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push(ROUTES.LOGIN);
    router.refresh();
  }

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <nav className="flex items-center gap-6">
          <span className="font-semibold">OutreachAgent</span>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm text-muted-foreground hover:text-foreground",
                pathname === link.href && "font-medium text-foreground",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{userEmail}</span>
          <Button variant="outline" size="sm" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </header>
  );
}

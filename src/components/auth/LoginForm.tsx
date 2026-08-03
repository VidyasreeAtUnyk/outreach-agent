"use client";

/**
 * Email/password sign-in (and sign-up, for first-time setup) form backed by
 * Supabase Auth. This is a single-user tool, so sign-up exists only to
 * create that one account — see docs/decisions/03-supabase-for-tracking.md.
 */
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ROUTES } from "@/lib/constants";

type Mode = "sign-in" | "sign-up";

export function LoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();

    try {
      if (mode === "sign-in") {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError(signInError.message);
          return;
        }
        router.push(ROUTES.HOME);
        router.refresh();
      } else {
        const { error: signUpError } = await supabase.auth.signUp({ email, password });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }
        setConfirmationSent(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>OutreachAgent</CardTitle>
        <CardDescription>
          {mode === "sign-in" ? "Sign in to continue." : "Create your account."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {confirmationSent ? (
          <p className="text-sm text-muted-foreground">
            Check your email to confirm your account, then sign in.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Sign up"}
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground underline underline-offset-4"
              onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}
            >
              {mode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
            </button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

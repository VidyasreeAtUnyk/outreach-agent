import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OutreachAgent",
  description: "Researches UAE tech companies and drafts reviewed cold job-application emails.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground">{children}</body>
    </html>
  );
}

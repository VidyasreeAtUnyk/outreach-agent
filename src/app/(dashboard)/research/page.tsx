import { CompanyForm } from "@/components/research/CompanyForm";

export default function ResearchPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Research a company</h1>
        <p className="text-sm text-muted-foreground">
          Give it a URL and it will research the company, match it to a portfolio project, and
          draft a cold application email for you to review.
        </p>
      </div>
      <CompanyForm />
    </div>
  );
}

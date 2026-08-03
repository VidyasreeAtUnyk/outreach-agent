import { DiscoverForm } from "@/components/research/DiscoverForm";

export default function DiscoverPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Discover companies</h1>
        <p className="text-sm text-muted-foreground">
          Describe the kind of company you&apos;re looking for and it will search for candidates and save
          them for review. Finding candidates costs one search and one AI call, however many it finds —
          researching each one individually (and spending AI budget) is a separate step you choose per
          company.
        </p>
      </div>
      <DiscoverForm />
    </div>
  );
}

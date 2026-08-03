import { createClient } from "@/lib/supabase/server";
import { mapCompanyRow, mapContactRow, mapDraftRow } from "@/lib/supabase/mappers";
import { ReviewQueueTable } from "@/components/review/ReviewQueueTable";
import type { DraftWithRelations } from "@/types";

/** Review queue: every drafted email, filterable by status/industry and sortable by confidence or date. */
export default async function ReviewQueuePage() {
  const supabase = await createClient();

  const [draftsResult, companiesResult, contactsResult] = await Promise.all([
    supabase.from("drafts").select("*").order("created_at", { ascending: false }),
    supabase.from("companies").select("*"),
    supabase.from("contacts").select("*"),
  ]);

  const companiesById = new Map((companiesResult.data ?? []).map((row) => [row.id, mapCompanyRow(row)]));
  const contactsById = new Map((contactsResult.data ?? []).map((row) => [row.id, mapContactRow(row)]));

  const drafts: DraftWithRelations[] = (draftsResult.data ?? [])
    .map(mapDraftRow)
    .filter((draft) => companiesById.has(draft.companyId))
    .map((draft) => ({
      ...draft,
      company: companiesById.get(draft.companyId)!,
      contact: draft.contactId ? (contactsById.get(draft.contactId) ?? null) : null,
    }));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Review queue</h1>
        <p className="text-sm text-muted-foreground">
          Every drafted email lives here until you approve, edit, or reject it.
        </p>
      </div>
      <ReviewQueueTable drafts={drafts} />
    </div>
  );
}

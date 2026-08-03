import { createClient } from "@/lib/supabase/server";
import { mapCompanyRow, mapContactRow, mapDraftRow, mapReplyRow } from "@/lib/supabase/mappers";
import { OutreachRow } from "@/components/tracker/OutreachRow";
import { DRAFT_STATUS } from "@/lib/constants";
import type { DraftWithRelations } from "@/types";

/** Tracker: every approved-or-later outreach, with actions to mark it sent and log replies. */
export default async function TrackerPage() {
  const supabase = await createClient();

  const [draftsResult, companiesResult, contactsResult, repliesResult] = await Promise.all([
    supabase
      .from("drafts")
      .select("*")
      .in("status", [DRAFT_STATUS.APPROVED, DRAFT_STATUS.EDITED, DRAFT_STATUS.SENT])
      .order("created_at", { ascending: false }),
    supabase.from("companies").select("*"),
    supabase.from("contacts").select("*"),
    supabase.from("replies").select("*").order("created_at", { ascending: false }),
  ]);

  const companiesById = new Map((companiesResult.data ?? []).map((row) => [row.id, mapCompanyRow(row)]));
  const contactsById = new Map((contactsResult.data ?? []).map((row) => [row.id, mapContactRow(row)]));
  const repliesByDraftId = new Map<string, ReturnType<typeof mapReplyRow>>();
  for (const row of repliesResult.data ?? []) {
    const reply = mapReplyRow(row);
    if (!repliesByDraftId.has(reply.draftId)) {
      repliesByDraftId.set(reply.draftId, reply);
    }
  }

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
        <h1 className="text-2xl font-semibold">Tracker</h1>
        <p className="text-sm text-muted-foreground">
          Approved and sent outreach. Mark an email sent once you&apos;ve copied it into Gmail, and log
          replies as they come in.
        </p>
      </div>

      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet — approved drafts show up once you&apos;ve reviewed them.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {drafts.map((draft) => (
            <OutreachRow key={draft.id} draft={draft} latestReply={repliesByDraftId.get(draft.id) ?? null} />
          ))}
        </div>
      )}
    </div>
  );
}

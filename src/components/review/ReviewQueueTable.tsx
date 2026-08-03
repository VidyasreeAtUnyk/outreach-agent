"use client";

/**
 * Client-side filter/sort over the drafts fetched by the server component
 * (app/(dashboard)/review/page.tsx). The dataset is small (a personal
 * tool's outreach volume, not a multi-tenant queue), so filtering in the
 * browser keeps this simple rather than pushing filter state into the URL
 * and re-querying Supabase per change.
 */
import { useMemo, useState } from "react";
import { DraftCard } from "@/components/review/DraftCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DraftWithRelations } from "@/types";

type StatusFilter = "all" | DraftWithRelations["status"];
type SortBy = "confidence" | "date";

export function ReviewQueueTable({ drafts }: { drafts: DraftWithRelations[] }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortBy>("confidence");

  const industries = useMemo(
    () =>
      Array.from(
        new Set(
          drafts.map((d) => d.company.industry).filter((v): v is NonNullable<typeof v> => v !== null),
        ),
      ),
    [drafts],
  );

  const filtered = useMemo(() => {
    let result = drafts;
    if (statusFilter !== "all") {
      result = result.filter((d) => d.status === statusFilter);
    }
    if (industryFilter !== "all") {
      result = result.filter((d) => d.company.industry === industryFilter);
    }
    return [...result].sort((a, b) => {
      if (sortBy === "confidence") {
        return (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0);
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [drafts, statusFilter, industryFilter, sortBy]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="edited">Edited</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
          </SelectContent>
        </Select>

        <Select value={industryFilter} onValueChange={setIndustryFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Industry" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All industries</SelectItem>
            {industries.map((industry) => (
              <SelectItem key={industry} value={industry}>
                {industry}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortBy)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="confidence">Sort by confidence score</SelectItem>
            <SelectItem value="date">Sort by date</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No drafts match these filters.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((draft) => (
            <DraftCard key={draft.id} draft={draft} />
          ))}
        </div>
      )}
    </div>
  );
}

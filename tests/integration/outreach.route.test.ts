import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers";

let mockSupabase: ReturnType<typeof createMockSupabase>;

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mockSupabase }));

const VALID_DRAFT_ID = "22222222-2222-2222-2222-222222222222";

function request(url: string, body: unknown) {
  return new NextRequest(url, { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/outreach/approve", () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase([{ data: { id: VALID_DRAFT_ID, status: "approved" }, error: null }]);
  });

  it("marks status 'approved' when no edits are supplied", async () => {
    const { POST } = await import("@/app/api/outreach/approve/route");
    const response = await POST(request("http://localhost/api/outreach/approve", { draftId: VALID_DRAFT_ID }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.status).toBe("approved");
  });

  it("returns 400 for a missing draftId", async () => {
    const { POST } = await import("@/app/api/outreach/approve/route");
    const response = await POST(request("http://localhost/api/outreach/approve", {}));
    expect(response.status).toBe(400);
  });
});

describe("POST /api/outreach/edit", () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase([{ data: { id: VALID_DRAFT_ID, status: "edited" }, error: null }]);
  });

  it("returns 400 when neither subject nor body is provided", async () => {
    const { POST } = await import("@/app/api/outreach/edit/route");
    const response = await POST(request("http://localhost/api/outreach/edit", { draftId: VALID_DRAFT_ID }));
    expect(response.status).toBe(400);
  });

  it("saves an edit and returns status 'edited'", async () => {
    const { POST } = await import("@/app/api/outreach/edit/route");
    const response = await POST(
      request("http://localhost/api/outreach/edit", { draftId: VALID_DRAFT_ID, body: "New body text" }),
    );
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.status).toBe("edited");
  });
});

describe("POST /api/outreach/reject", () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase([{ data: { id: VALID_DRAFT_ID, status: "rejected" }, error: null }]);
  });

  it("marks the draft rejected", async () => {
    const { POST } = await import("@/app/api/outreach/reject/route");
    const response = await POST(request("http://localhost/api/outreach/reject", { draftId: VALID_DRAFT_ID }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.status).toBe("rejected");
  });

  it("returns 404 when the draft doesn't exist for this user", async () => {
    mockSupabase = createMockSupabase([{ data: null, error: { message: "not found" } }]);
    const { POST } = await import("@/app/api/outreach/reject/route");
    const response = await POST(request("http://localhost/api/outreach/reject", { draftId: VALID_DRAFT_ID }));
    expect(response.status).toBe(404);
  });
});

describe("POST /api/tracker/mark-sent", () => {
  it("marks an approved draft sent", async () => {
    mockSupabase = createMockSupabase([{ data: { id: VALID_DRAFT_ID, status: "sent" }, error: null }]);
    const { POST } = await import("@/app/api/tracker/mark-sent/route");
    const response = await POST(request("http://localhost/api/tracker/mark-sent", { draftId: VALID_DRAFT_ID }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.status).toBe("sent");
  });

  it("returns 404 when the draft isn't approved or edited yet", async () => {
    mockSupabase = createMockSupabase([{ data: null, error: { message: "no rows" } }]);
    const { POST } = await import("@/app/api/tracker/mark-sent/route");
    const response = await POST(request("http://localhost/api/tracker/mark-sent", { draftId: VALID_DRAFT_ID }));
    expect(response.status).toBe(404);
  });
});

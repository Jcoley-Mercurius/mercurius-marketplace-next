import { describe, expect, it } from "vitest";
import { notificationKeysetFilter } from "@/lib/notificationKeyset";

// Phase 7.2B / TRACE-153. The same filter is exercised against real PostgREST and SQL 119's mirror.
describe("notification keyset cursor", () => {
  it("selects rows strictly after the cursor in (created_at desc, id desc) order", () => {
    expect(notificationKeysetFilter({ created_at: "2026-01-01T10:00:03.123456+00:00", id: "00000000-0000-4000-8000-000000000009" }))
      .toBe('created_at.lt."2026-01-01T10:00:03.123456+00:00",and(created_at.eq."2026-01-01T10:00:03.123456+00:00",id.lt."00000000-0000-4000-8000-000000000009")');
  });

  it("keeps quotes and backslashes inside the quoted value", () => {
    expect(notificationKeysetFilter({ created_at: 'x"),id.gt.(', id: "a\\b" }))
      .toBe('created_at.lt."x\\"),id.gt.(",and(created_at.eq."x\\"),id.gt.(",id.lt."a\\\\b")');
  });
});

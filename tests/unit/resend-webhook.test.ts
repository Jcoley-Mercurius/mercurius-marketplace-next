// TRACE-155 (Phase 7.3B): the dormant Resend webhook receiver, synthetic only.
// Locally generated secrets (never literals), independent HMAC signing with node:crypto over
// the exact bytes sent, and the real exact-pinned svix verifier wrapped in spies. Plan §14:
// S-1 to S-20, S-24, S-26, S-28 to S-30 here; the database cases are in
// supabase/tests/121_email_provider_events.sql and scripts/email-provider-events-concurrency.mjs.
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookVerificationError } from "svix";
import {
  RESEND_WEBHOOK_MAX_BYTES,
  correlationTags,
  createExactDecoder,
  createSvixVerifier,
  handleResendWebhook,
  normalizeResendEvent,
  type ReceiveParams,
  type ResendWebhookDeps,
  type TextDecoderLike,
  type WebhookVerifier,
} from "@/lib/emailEvidence/resendWebhook";
import {
  buildOperationalLogRecord,
  type OperationalLogInput,
} from "@/lib/observability/operationalLog";

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);
const newSecret = () => `whsec_${randomBytes(32).toString("base64")}`;
const nowSeconds = () => String(Math.floor(Date.now() / 1000));

/** Independent of svix: HMAC-SHA256 over `id.timestamp.` followed by the exact body bytes. */
function sign(secret: string, id: string, timestamp: string, body: Uint8Array) {
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.`).update(body).digest("base64")}`;
}

type Body = { stream: ReadableStream<Uint8Array>; pulls: number; cancelled: boolean };
/** A body that is pulled only on read (highWaterMark 0), so "not read" is observable. */
function streamOf(chunks: Uint8Array[]): Body {
  const state = { pulls: 0, cancelled: false } as Body;
  let index = 0;
  state.stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulls++;
        if (index < chunks.length) controller.enqueue(chunks[index++]);
        else controller.close();
      },
      cancel() {
        state.cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  return state;
}

function chunked(data: Uint8Array, size: number) {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < data.byteLength; offset += size) chunks.push(data.slice(offset, offset + size));
  return chunks;
}

const forbidden = () => {
  throw new Error("the receiver must read the body only through its bounded stream reader");
};
function fakeRequest(headers: Record<string, string>, body: Body | null, method = "POST") {
  const access = { body: 0 };
  const request = {
    method,
    headers: new Headers(headers),
    get body() {
      access.body++;
      return body ? body.stream : null;
    },
    text: forbidden,
    json: forbidden,
    arrayBuffer: forbidden,
    blob: forbidden,
    formData: forbidden,
    bytes: forbidden,
  } as unknown as Request;
  return { request, access };
}

type Harness = {
  deps: ResendWebhookDeps;
  current: string;
  previous?: string;
  logs: OperationalLogInput[];
  received: ReceiveParams[];
  verified: Array<{ slot: string; payload: string }>;
  decoders: { count: number };
  setResult: (value: unknown | Error) => void;
};

function harness(options: { current?: string | null; previous?: string; deps?: Partial<ResendWebhookDeps> } = {}): Harness {
  const current = options.current === undefined ? newSecret() : options.current;
  const logs: OperationalLogInput[] = [];
  const received: ReceiveParams[] = [];
  const verified: Array<{ slot: string; payload: string }> = [];
  const decoders = { count: 0 };
  let result: unknown = { result: "recorded" };
  const deps: ResendWebhookDeps = {
    secrets: () => ({ current: current ?? undefined, previous: options.previous }),
    createVerifier: (secret) => {
      const real = createSvixVerifier(secret);
      const slot = secret === current ? "current" : "previous";
      return {
        verify(payload, headers) {
          verified.push({ slot, payload });
          return real.verify(payload, headers);
        },
      };
    },
    createDecoder: () => {
      decoders.count++;
      return createExactDecoder();
    },
    receive: async (params) => {
      received.push(params);
      if (result instanceof Error) throw result;
      return result;
    },
    log: (input) => logs.push(input),
    correlationId: () => "6f1c2a8e-0000-4000-8000-000000000001",
    now: () => 0,
    ...options.deps,
  };
  return {
    deps,
    current: current ?? "",
    previous: options.previous,
    logs,
    received,
    verified,
    decoders,
    setResult: (value) => {
      result = value;
    },
  };
}

type Delivery = {
  body?: Uint8Array | string;
  signedBody?: Uint8Array | string;
  secret?: string;
  id?: string;
  timestamp?: string;
  signature?: string;
  chunkSize?: number;
  chunks?: Uint8Array[];
  headers?: Record<string, string>;
  omit?: string[];
};

async function deliver(h: Harness, delivery: Delivery = {}) {
  const body = typeof delivery.body === "string" ? bytes(delivery.body) : (delivery.body ?? bytes(event()));
  const signedBody = delivery.signedBody === undefined ? body
    : typeof delivery.signedBody === "string" ? bytes(delivery.signedBody) : delivery.signedBody;
  const id = delivery.id ?? "msg_synthetic_0001";
  const timestamp = delivery.timestamp ?? nowSeconds();
  const signature = delivery.signature ?? sign(delivery.secret ?? h.current, id, timestamp, signedBody);
  const headers: Record<string, string> = {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature": signature,
    "content-type": "application/json",
    ...delivery.headers,
  };
  for (const name of delivery.omit ?? []) delete headers[name];
  const stream = streamOf(delivery.chunks ?? chunked(body, delivery.chunkSize ?? 16_384));
  const { request, access } = fakeRequest(headers, stream);
  const response = await handleResendWebhook(request, h.deps);
  return { response, status: response.status, json: await response.json(), stream, access };
}

function event(overrides: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "email.delivered",
    created_at: "2026-11-16T10:00:00.000Z",
    data: { email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", ...data },
    ...overrides,
  });
}

function expectNothingAfterRejection(h: Harness, result: { stream: Body }, { read }: { read: boolean }) {
  expect(h.received).toEqual([]);
  if (!read) {
    expect(result.stream.pulls).toBe(0);
    expect(h.decoders.count).toBe(0);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("7.3B configuration gate and method (S-1, S-30)", () => {
  it("S-1: no secret → 503, body not read, nothing verified or stored", async () => {
    const h = harness({ current: null });
    const result = await deliver(h, { secret: newSecret() });
    expect(result.status).toBe(503);
    expect(result.access.body).toBe(0);
    expect(result.stream.pulls).toBe(0);
    expect(h.verified).toEqual([]);
    expectNothingAfterRejection(h, result, { read: false });
    expect(h.logs).toMatchObject([{ event: "email_webhook.refused", outcome: "refused", errorCode: "config_missing" }]);
  });

  it.each(["not-a-secret", "whsec_====", "whsec_", "whsec_short"])("S-1: a malformed current secret %j → 503, body not read", async (secret) => {
    const h = harness({ current: secret });
    const result = await deliver(h, { secret: newSecret() });
    expect(result.status).toBe(503);
    expect(result.access.body).toBe(0);
    expectNothingAfterRejection(h, result, { read: false });
  });

  it("S-1: a malformed previous secret, or a constructor that throws → 503", async () => {
    const bad = harness({ previous: "whsec_====" });
    expect((await deliver(bad)).status).toBe(503);
    const throwing = harness({ deps: { createVerifier: () => { throw new Error("Secret can't be empty."); } } });
    const result = await deliver(throwing);
    expect(result.status).toBe(503);
    expect(result.access.body).toBe(0);
  });

  it("S-30: non-POST → 405 before configuration or the body is read", async () => {
    const h = harness();
    for (const method of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
      const stream = streamOf([bytes(event())]);
      const { request, access } = fakeRequest({}, stream, method);
      const response = await handleResendWebhook(request, h.deps);
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
      expect(access.body).toBe(0);
    }
    expect(h.logs).toEqual([]);
  });

  it("S-30: the route exports refuse every other method; POST is dormant without the secret", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    const route = await import("@/app/api/webhooks/resend/route");
    expect(route.runtime).toBe("nodejs");
    for (const handler of [route.GET, route.HEAD, route.PUT, route.PATCH, route.DELETE, route.OPTIONS]) {
      expect((await handler()).status).toBe(405);
    }
    const info = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stream = streamOf([bytes(event())]);
    const { request, access } = fakeRequest({}, stream);
    const response = await route.POST(request);
    expect(response.status).toBe(503);
    expect(access.body).toBe(0);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({
      schema: "mercurius.oplog.v2", event: "email_webhook.refused", route: "resend_webhook", error_code: "config_missing",
    });
    info.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("7.3B header bounds (S-2, S-2a)", () => {
  const cases: Array<[string, Delivery]> = [
    ["svix-id missing", { omit: ["svix-id"] }],
    ["svix-timestamp missing", { omit: ["svix-timestamp"] }],
    ["svix-signature missing", { omit: ["svix-signature"] }],
    ["svix-id empty", { id: "" }],
    ["svix-id 129 bytes", { id: "a".repeat(129) }],
    ["svix-id with a space", { id: "msg 1" }],
    ["timestamp 123abc", { timestamp: "123abc" }],
    ["timestamp with an internal space", { headers: { "svix-timestamp": "12 3" } }],
    ["timestamp 13 digits", { timestamp: "1".repeat(13) }],
    ["signature over 1,024 bytes", { signature: Array.from({ length: 8 }, () => `v1,${"a".repeat(125)}`).join(" ").padEnd(1025, "b") }],
    ["9 signature entries", { signature: Array.from({ length: 9 }, () => "v1,abc").join(" ") }],
    ["a signature entry over 128 bytes", { signature: `v1,${"a".repeat(126)}` }],
    ["an empty signature entry", { signature: "v1,abc  v1,def" }],
  ];
  it.each(cases)("S-2: %s → 400; body not read; verify not called", async (_label, delivery) => {
    const h = harness();
    const result = await deliver(h, delivery);
    expect(result.status).toBe(400);
    expect(result.access.body).toBe(0);
    expect(h.verified).toEqual([]);
    expectNothingAfterRejection(h, result, { read: false });
    expect(h.logs).toMatchObject([{ event: "email_webhook.refused", errorCode: "webhook_headers_invalid" }]);
  });

  it("S-2: a leading space is removed by the Web Headers API itself; the verifier then rejects the time", async () => {
    // Deviation from the plan's S-2 wording, recorded in the 7.3B record §5: Headers strips
    // surrounding whitespace, so " 123" reaches the route as the strict-format "123".
    expect(new Headers({ "svix-timestamp": " 123" }).get("svix-timestamp")).toBe("123");
    const h = harness();
    const result = await deliver(h, { headers: { "svix-timestamp": " 123" } });
    expect(result.status).toBe(400);
    expect(h.received).toEqual([]);
    expect(h.logs).toMatchObject([{ errorCode: "webhook_signature_invalid" }]);
  });

  it("S-2: a non-ASCII byte in svix-id → 400", async () => {
    const h = harness();
    const { request, access } = fakeRequest({ "svix-id": "msg_é", "svix-timestamp": nowSeconds(), "svix-signature": "v1,abc" }, streamOf([]));
    expect((await handleResendWebhook(request, h.deps)).status).toBe(400);
    expect(access.body).toBe(0);
  });

  it("S-2a: a 128-byte svix-id without a msg_ prefix and a 12-digit timestamp are accepted", async () => {
    const h = harness();
    const id = "Z".repeat(128);
    const result = await deliver(h, { id });
    expect(result.status).toBe(200);
    expect(h.received[0].p_svix_id).toBe(id);
    // A 12-digit timestamp passes the bounds and reaches the verifier (whose fixed ±300 s
    // check then rejects it as out of range).
    const late = harness();
    const far = await deliver(late, { timestamp: "999999999999" });
    expect(far.status).toBe(400);
    expect(late.verified).toHaveLength(1);
    expect(late.logs).toMatchObject([{ errorCode: "webhook_signature_invalid" }]);
  });

  it("S-2a: 8 entries, one exactly 128 bytes, the matching v1 entry last → verifies", async () => {
    const h = harness();
    const id = "msg_boundary";
    const timestamp = nowSeconds();
    const body = bytes(event());
    const match = sign(h.current, id, timestamp, body);
    const fillers = [`v1,${"A".repeat(125)}`, ...Array.from({ length: 6 }, (_, i) => `v2,filler${i}`)];
    expect(fillers[0]).toHaveLength(128);
    const result = await deliver(h, { body, id, timestamp, signature: [...fillers, match].join(" ") });
    expect(result.status).toBe(200);
    expect(h.received).toHaveLength(1);
  });

  it("S-2a: a signature header of exactly 1,024 bytes passes the bounds and reaches the verifier", async () => {
    // With at most 8 entries of at most 128 bytes, a header of 1,024 bytes cannot also carry a
    // matching v1 entry (47 bytes): 7 × 128 + 47 + 7 = 950. The boundary is therefore proven
    // as "reaches verification"; a 1,025-byte header is refused before it (S-2).
    const h = harness();
    const signature = [...Array.from({ length: 7 }, () => `v1,${"B".repeat(125)}`), `v1,${"C".repeat(118)}`].join(" ");
    expect(signature).toHaveLength(1024);
    const result = await deliver(h, { signature });
    expect(h.verified).toHaveLength(1);
    expect(result.status).toBe(400);
    expect(h.logs).toMatchObject([{ errorCode: "webhook_signature_invalid" }]);
  });
});

describe("7.3B bounded byte read (S-3 to S-7)", () => {
  it("S-3: Content-Length 70,000 with a small body → 413 before reading", async () => {
    const h = harness();
    const result = await deliver(h, { headers: { "content-length": "70000" } });
    expect(result.status).toBe(413);
    expect(result.stream.pulls).toBe(0);
    expectNothingAfterRejection(h, result, { read: false });
    expect(h.logs).toMatchObject([{ event: "email_webhook.refused", errorCode: "webhook_payload_too_large" }]);
  });

  it("S-4: no Content-Length, chunked 65,537 bytes → 413; reader cancelled; no decode, verify or RPC", async () => {
    const h = harness();
    const body = bytes("x".repeat(RESEND_WEBHOOK_MAX_BYTES + 1));
    const result = await deliver(h, { body, chunkSize: 4096 });
    expect(result.status).toBe(413);
    expect(result.stream.cancelled).toBe(true);
    expect(h.decoders.count).toBe(0);
    expect(h.verified).toEqual([]);
    expect(h.received).toEqual([]);
  });

  it("S-5: a false Content-Length (declares 100, streams 80,000) → 413 at the byte ceiling", async () => {
    const h = harness();
    const result = await deliver(h, { body: bytes("y".repeat(80_000)), headers: { "content-length": "100" }, chunkSize: 1000 });
    expect(result.status).toBe(413);
    expect(result.stream.cancelled).toBe(true);
    expect(result.stream.pulls).toBeLessThanOrEqual(66);
    expect(h.verified).toEqual([]);
  });

  it.each(["abc", "-1", "1e9", ""])("S-6: an invalid Content-Length %j is ignored; the byte ceiling still applies", async (length) => {
    const small = harness();
    expect((await deliver(small, { headers: { "content-length": length } })).status).toBe(200);
    const large = harness();
    const result = await deliver(large, { body: bytes("z".repeat(70_000)), headers: { "content-length": length } });
    expect(result.status).toBe(413);
    expect(result.stream.cancelled).toBe(true);
  });

  function exactlySized(total: number) {
    const prefix = '{"type":"email.delivered","data":{"email_id":"em-size","pad":"';
    const suffix = '"}}';
    const room = total - bytes(prefix).byteLength - bytes(suffix).byteLength;
    const pad = "é".repeat(Math.floor(room / 2)) + (room % 2 ? "a" : "");
    const text = prefix + pad + suffix;
    expect(bytes(text).byteLength).toBe(total);
    expect(text.length).toBeLessThan(total);
    return text;
  }

  it("S-7: exactly 65,536 bytes of multibyte text (byte count ≠ character count) is accepted when signed", async () => {
    const h = harness();
    const text = exactlySized(RESEND_WEBHOOK_MAX_BYTES);
    const result = await deliver(h, { body: text, headers: { "content-length": String(RESEND_WEBHOOK_MAX_BYTES) } });
    expect(result.status).toBe(200);
    expect(h.verified[0].payload).toBe(text);
    expect(h.received[0].p_provider_email_id).toBe("em-size");
  });

  it("S-7: 65,537 bytes → 413", async () => {
    const h = harness();
    const result = await deliver(h, { body: exactlySized(RESEND_WEBHOOK_MAX_BYTES + 1) });
    expect(result.status).toBe(413);
    expect(h.verified).toEqual([]);
  });

  it("EC-8: the largest synthetic payload (75 tags, long bounce text) fits, with its margin recorded", () => {
    const tags = Object.fromEntries(Array.from({ length: 75 }, (_, i) => [`tag_${String(i).padStart(2, "0")}_${"k".repeat(40)}`, "v".repeat(256)]));
    const payload = JSON.stringify({
      type: "email.bounced",
      created_at: "2026-11-16T10:00:00.000Z",
      data: {
        email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", created_at: "2026-11-16T10:00:00.000Z",
        from: "Mercurius <notifications@example.test>", to: Array.from({ length: 50 }, (_, i) => `recipient${i}@example.test`),
        subject: "s".repeat(998), message_id: `<${"m".repeat(200)}@example.test>`, broadcast_id: null, template_id: null,
        bounce: { type: "Permanent", subType: "General", message: "b".repeat(4000), diagnosticCode: ["d".repeat(1000)] },
        tags,
      },
    });
    const size = bytes(payload).byteLength;
    expect(size).toBeLessThan(RESEND_WEBHOOK_MAX_BYTES);
    // Recorded in the 7.3B record §5: 31,108 bytes, a margin of 34,428 bytes (52.5%).
    expect(size).toBe(31_108);
  });
});

describe("7.3B exact-byte decoding (S-8 to S-10, C1)", () => {
  const BOM = new Uint8Array([0xef, 0xbb, 0xbf]);
  const withBom = (text: string) => new Uint8Array([...BOM, ...bytes(text)]);

  it("S-8: a multibyte character split across two chunks decodes and verifies", async () => {
    const h = harness();
    const text = event({}, { note: "€" });
    const data = bytes(text);
    const split = data.indexOf(0xe2) + 1;
    const result = await deliver(h, { body: data, chunks: [data.slice(0, split), data.slice(split)] });
    expect(result.status).toBe(200);
    expect(h.verified[0].payload).toBe(text);
  });

  it("S-8a: a signed body with a leading BOM verifies with U+FEFF intact, then fails JSON.parse → 200 invalid_payload", async () => {
    const h = harness();
    const body = withBom(event());
    const result = await deliver(h, { body });
    expect(result.status).toBe(200);
    expect(h.verified[0].payload.charCodeAt(0)).toBe(0xfeff);
    expect(encoder.encode(h.verified[0].payload)).toEqual(body);
    expect(h.received[0]).toMatchObject({ p_processing: "invalid_payload", p_event_type: "other", p_provider_email_id: null });
    expect(h.logs).toMatchObject([{ event: "email_webhook.rejected", errorCode: "webhook_payload_invalid", outcome: "recorded" }]);
  });

  it("S-8b: a BOM sent but not signed, and a BOM signed but not sent → 400 both ways", async () => {
    const sentOnly = harness();
    expect((await deliver(sentOnly, { body: withBom(event()), signedBody: event() })).status).toBe(400);
    const signedOnly = harness();
    expect((await deliver(signedOnly, { body: event(), signedBody: withBom(event()) })).status).toBe(400);
    expect([...sentOnly.received, ...signedOnly.received]).toEqual([]);
  });

  it("S-8c: mutation — a decoder with default BOM handling drops the byte and is caught before verify", async () => {
    const h = harness({ deps: { createDecoder: () => new TextDecoder("utf-8", { fatal: true }) } });
    const result = await deliver(h, { body: withBom(event()) });
    expect(result.status).toBe(500);
    expect(h.verified).toEqual([]);
    expect(h.received).toEqual([]);
  });

  it("S-8c: the production decoder keeps the BOM", () => {
    expect(createExactDecoder().decode(withBom("{}")).charCodeAt(0)).toBe(0xfeff);
  });

  it("S-8d: a 4-byte character split across three chunks, and 1-byte chunks", async () => {
    const text = event({}, { note: "a😀b" });
    const data = bytes(text);
    const start = data.indexOf(0xf0);
    const three = harness();
    const result = await deliver(three, { body: data, chunks: [data.slice(0, start + 1), data.slice(start + 1, start + 3), data.slice(start + 3)] });
    expect(result.status).toBe(200);
    expect(encoder.encode(three.verified[0].payload)).toEqual(data);
    const ones = harness();
    expect((await deliver(ones, { body: data, chunkSize: 1 })).status).toBe(200);
    expect(ones.verified[0].payload).toBe(text);
  });

  it.each([["é", 2], ["€", 3], ["😀", 4]])("S-8d: a %s (%i bytes) ending exactly at the 65,536-byte ceiling, split across chunks", async (character, width) => {
    const h = harness();
    const fill = RESEND_WEBHOOK_MAX_BYTES - (width as number);
    const text = "x".repeat(fill) + character;
    const data = bytes(text);
    expect(data.byteLength).toBe(RESEND_WEBHOOK_MAX_BYTES);
    const result = await deliver(h, { body: data, chunks: [data.slice(0, fill + 1), data.slice(fill + 1)] });
    expect(result.status).toBe(200);
    expect(encoder.encode(h.verified[0].payload)).toEqual(data);
    expect(h.received[0].p_processing).toBe("invalid_payload");
  });

  it.each([
    ["a trailing \\n", `${event()}\n`, event()],
    ["a trailing \\r\\n", `${event()}\r\n`, `${event()}\n`],
    ["leading spaces", `   ${event()}`, ` ${event()}`],
    ["internal tabs", event().replace(",", ",\t"), event()],
  ])("S-8e: %s is preserved exactly; any altered variant → 400", async (_label, exact, altered) => {
    const ok = harness();
    expect((await deliver(ok, { body: exact })).status).toBe(200);
    expect(ok.verified[0].payload).toBe(exact);
    const changed = harness();
    expect((await deliver(changed, { body: altered, signedBody: exact })).status).toBe(400);
    expect(changed.received).toEqual([]);
  });

  it("S-8f: a decode that does not re-encode to the received bytes → 500; verify not called", async () => {
    const lossy: TextDecoderLike = { decode: (input) => new TextDecoder().decode(input).replace("delivered", "delivere") };
    const h = harness({ deps: { createDecoder: () => lossy } });
    const result = await deliver(h);
    expect(result.status).toBe(500);
    expect(h.verified).toEqual([]);
    expect(h.received).toEqual([]);
    expect(h.logs).toMatchObject([{ event: "email_webhook.failed", errorCode: "unexpected" }]);
  });

  it("S-9: invalid UTF-8 → 400; verify not called", async () => {
    const h = harness();
    const result = await deliver(h, { body: new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]) });
    expect(result.status).toBe(400);
    expect(h.verified).toEqual([]);
    expect(h.logs).toMatchObject([{ event: "email_webhook.refused", errorCode: "webhook_payload_invalid_encoding" }]);
  });

  it("S-10: text(), json(), arrayBuffer(), blob(), formData() and bytes() are never used", async () => {
    // fakeRequest makes each of them throw; a receiver that used one would fail every case.
    const h = harness();
    expect((await deliver(h)).status).toBe(200);
  });
});

describe("7.3B authentication (S-11 to S-18)", () => {
  it.each([
    ["a wrong signature", { signature: `v1,${Buffer.alloc(32).toString("base64")}` }],
    ["a different secret", { secret: newSecret() }],
    ["a truncated signature", {}],
    ["only non-v1 entries", {}],
  ] as Array<[string, Delivery]>)("S-11: %s → 400", async (label, delivery) => {
    const h = harness();
    const id = "msg_synthetic_0001";
    const timestamp = nowSeconds();
    const valid = sign(h.current, id, timestamp, bytes(event()));
    const signature = label === "a truncated signature" ? valid.slice(0, -4)
      : label === "only non-v1 entries" ? valid.replace("v1,", "v2,") : delivery.signature;
    const result = await deliver(h, { ...delivery, id, timestamp, ...(signature ? { signature } : {}) });
    expect(result.status).toBe(400);
    expect(h.received).toEqual([]);
    expect(h.logs).toMatchObject([{ event: "email_webhook.refused", errorCode: "webhook_signature_invalid" }]);
  });

  it("S-12: one byte altered after signing → 400", async () => {
    const h = harness();
    const signed = bytes(event());
    const sent = signed.slice();
    sent[10] ^= 0x01;
    expect((await deliver(h, { body: sent, signedBody: signed })).status).toBe(400);
    expect(h.received).toEqual([]);
  });

  it("S-13: 301 s old or 301 s ahead → 400 from the verifier's fixed check; 299 s is accepted; no own range check", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
    const now = Math.floor(Date.now() / 1000);
    for (const [offset, status] of [[-301, 400], [301, 400], [-299, 200], [299, 200]] as const) {
      const h = harness();
      const result = await deliver(h, { timestamp: String(now + offset) });
      expect(result.status, `offset ${offset}`).toBe(status);
      expect(h.verified).toHaveLength(1);
    }
  });

  it("S-14: several v1 entries, only the second matching → accepted", async () => {
    const h = harness();
    const id = "msg_two";
    const timestamp = nowSeconds();
    const signature = `${sign(newSecret(), id, timestamp, bytes(event()))} ${sign(h.current, id, timestamp, bytes(event()))}`;
    expect((await deliver(h, { id, timestamp, signature })).status).toBe(200);
  });

  it("S-15: signed with the previous secret only → accepted, slot previous; previous unset → 400", async () => {
    const previous = newSecret();
    const h = harness({ previous });
    const result = await deliver(h, { secret: previous });
    expect(result.status).toBe(200);
    expect(h.received[0].p_secret_slot).toBe("previous");
    expect(h.verified.map((call) => call.slot)).toEqual(["current", "previous"]);
    const current = harness();
    expect((await deliver(current)).status).toBe(200);
    expect(current.received[0].p_secret_slot).toBe("current");
    const unset = harness();
    expect((await deliver(unset, { secret: previous })).status).toBe(400);
  });

  it("S-15a: a current-verifier timestamp failure is final: the previous secret is not tried", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
    const previous = newSecret();
    const h = harness({ previous });
    const stale = String(Math.floor(Date.now() / 1000) - 400);
    const result = await deliver(h, { secret: previous, timestamp: stale });
    expect(result.status).toBe(400);
    expect(h.verified.map((call) => call.slot)).toEqual(["current"]);
  });

  it("S-15a: a current-verifier missing-header failure is final: the previous secret is not tried", async () => {
    const previous = newSecret();
    const calls: string[] = [];
    const verifierFor = (slot: string): WebhookVerifier => ({
      verify() {
        calls.push(slot);
        throw new WebhookVerificationError(slot === "current" ? "Missing required headers" : "No matching signature found");
      },
    });
    let built = 0;
    const h = harness({ previous, deps: { createVerifier: () => verifierFor(built++ === 0 ? "current" : "previous") } });
    expect((await deliver(h, { secret: previous })).status).toBe(400);
    expect(calls).toEqual(["current"]);
  });

  it("S-16: a non-WebhookVerificationError from the verifier → 500, no receipt, never 2xx", async () => {
    for (const where of ["current", "previous"]) {
      const previous = newSecret();
      let built = 0;
      const h = harness({
        previous,
        deps: {
          createVerifier: () => {
            const slot = built++ === 0 ? "current" : "previous";
            return {
              verify() {
                if (slot === where) throw new Error("Expected payload to be of type string or Buffer.");
                throw new WebhookVerificationError("No matching signature found");
              },
            };
          },
        },
      });
      const result = await deliver(h);
      expect(result.status, where).toBe(500);
      expect(h.received).toEqual([]);
      expect(h.logs).toMatchObject([{ event: "email_webhook.failed", errorCode: "unexpected" }]);
    }
  });

  it.each([
    ["non-JSON", "not json at all"],
    ["JSON without type", JSON.stringify({ data: { email_id: "em-1" } })],
    ["a JSON array", "[]"],
    ["a type with invalid characters", JSON.stringify({ type: "Email.Delivered" })],
    ["an empty body", ""],
  ])("S-17: verified %s → 200 invalid_payload receipt with no data", async (_label, body) => {
    const h = harness();
    const result = await deliver(h, { body });
    expect(result.status).toBe(200);
    expect(h.received).toEqual([{
      p_svix_id: "msg_synthetic_0001", p_secret_slot: "current", p_processing: "invalid_payload", p_event_type: "other",
      p_provider_type: null, p_provider_created_at: null, p_provider_email_id: null, p_bounce_type: null, p_bounce_subtype: null,
      p_tag_status: "absent", p_tag_ledger: null, p_tag_ref: null, p_tag_attempt: null,
    }]);
  });

  it("S-18: the same non-JSON body with an invalid signature → 400, no receipt", async () => {
    const h = harness();
    expect((await deliver(h, { body: "not json at all", secret: newSecret() })).status).toBe(400);
    expect(h.received).toEqual([]);
  });
});

describe("7.3B normalization (S-19, S-28, tags, bounces)", () => {
  it("S-19: a verified unknown type is stored as other with only its type and time", async () => {
    const h = harness();
    await deliver(h, { body: event({ type: "email.opened" }, { tags: { mm_ledger: "owner_email" } }) });
    expect(h.received[0]).toMatchObject({
      p_processing: "recorded", p_event_type: "other", p_provider_type: "email.opened",
      p_provider_created_at: "2026-11-16T10:00:00.000Z", p_provider_email_id: null, p_tag_status: "absent",
    });
  });

  it("maps every subscribed type and keeps bounce categories only on bounces", () => {
    for (const type of ["email.sent", "email.delivered", "email.delivery_delayed", "email.complained", "email.failed", "email.suppressed"]) {
      expect(normalizeResendEvent(event({ type }, { bounce: { type: "Permanent" } }))).toMatchObject({ p_event_type: type, p_bounce_type: null });
    }
    const cases: Array<[unknown, unknown, string | null, string | null]> = [
      ["Permanent", "General", "permanent", "general"],
      ["Transient", "MailboxFull", "transient", "mailbox_full"],
      ["Temporary", "MessageTooLarge", "transient", "message_too_large"],
      ["Undetermined", "Undetermined", "undetermined", "undetermined"],
      ["Permanent", "NoEmail", "permanent", "no_email"],
      ["Permanent", "OnAccountSuppressionList", "permanent", "suppressed"],
      ["Something", "Unheard", "other", "other"],
      [undefined, undefined, null, null],
      [42, ["x"], null, null],
    ];
    for (const [type, subType, expectedType, expectedSub] of cases) {
      expect(normalizeResendEvent(event({ type: "email.bounced" }, { bounce: { type, subType, message: "diagnostic" } }))).toMatchObject({
        p_bounce_type: expectedType, p_bounce_subtype: expectedSub,
      });
    }
  });

  it("validates the provider email ID and time; invalid values become null", () => {
    expect(normalizeResendEvent(event({}, { email_id: "someone@example.test" }))?.p_provider_email_id).toBeNull();
    expect(normalizeResendEvent(event({}, { email_id: "x".repeat(101) }))?.p_provider_email_id).toBeNull();
    expect(normalizeResendEvent(event({}, { email_id: 7 }))?.p_provider_email_id).toBeNull();
    expect(normalizeResendEvent(event({ created_at: "not a time" }))?.p_provider_created_at).toBeNull();
    expect(normalizeResendEvent(event({ created_at: "2026-11-16T05:00:00-05:00" }))?.p_provider_created_at).toBe("2026-11-16T10:00:00.000Z");
    expect(normalizeResendEvent(JSON.stringify({ type: "email.delivered", data: "nope" }))?.p_provider_email_id).toBeNull();
  });

  it("correlation tags: absent, valid as an object or array, and every malformed set is invalid", () => {
    const ref = "0b5c1f7e-3a4d-4e2b-9c8d-1f2e3a4b5c6d";
    expect(correlationTags(undefined).p_tag_status).toBe("absent");
    expect(correlationTags({ category: "x" }).p_tag_status).toBe("absent");
    expect(correlationTags({ mm_ledger: "owner_email", mm_ref: ref, mm_attempt: "3", other: "y" })).toEqual({
      p_tag_status: "valid", p_tag_ledger: "owner_email", p_tag_ref: ref, p_tag_attempt: 3,
    });
    expect(correlationTags([{ name: "mm_ledger", value: "application" }, { name: "mm_ref", value: ref }, { name: "mm_attempt", value: "10000" }]).p_tag_status).toBe("valid");
    const invalid = [
      { mm_ledger: "owner_email" },
      { mm_ledger: "owner_email", mm_ref: ref },
      { mm_ledger: "elsewhere", mm_ref: ref, mm_attempt: "1" },
      { mm_ledger: "owner_email", mm_ref: ref.toUpperCase(), mm_attempt: "1" },
      { mm_ledger: "owner_email", mm_ref: "not-a-uuid", mm_attempt: "1" },
      { mm_ledger: "owner_email", mm_ref: ref, mm_attempt: "0" },
      { mm_ledger: "owner_email", mm_ref: ref, mm_attempt: "10001" },
      { mm_ledger: "owner_email", mm_ref: ref, mm_attempt: "01" },
      { mm_ledger: "owner_email", mm_ref: ref, mm_attempt: 1 },
      { mm_ledger: "owner_email", mm_ref: ref, mm_attempt: "1", mm_extra: "x" },
      [{ name: "mm_ledger", value: "owner_email" }, { name: "mm_ledger", value: "owner_email" }, { name: "mm_ref", value: ref }, { name: "mm_attempt", value: "1" }],
    ];
    for (const tags of invalid) {
      expect(correlationTags(tags), JSON.stringify(tags)).toEqual({ p_tag_status: "invalid", p_tag_ledger: null, p_tag_ref: null, p_tag_attempt: null });
    }
  });

  it("S-28: sentinel PII in every non-retained field and in extra tags is absent from the RPC, logs and response", async () => {
    const sentinel = "sentinel-pii-7f3a@example.test";
    const h = harness();
    const body = JSON.stringify({
      type: "email.bounced",
      created_at: "2026-11-16T10:00:00.000Z",
      data: {
        email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", from: sentinel, to: [sentinel], subject: sentinel,
        message_id: `<${sentinel}>`, broadcast_id: sentinel, template_id: sentinel,
        bounce: { type: "Permanent", subType: "General", message: sentinel, diagnosticCode: [sentinel] },
        tags: { contact: sentinel, mm_note: sentinel },
        headers: [{ name: "X", value: sentinel }], click: { link: sentinel, ipAddress: sentinel, userAgent: sentinel },
      },
    });
    const result = await deliver(h, { body });
    expect(result.status).toBe(200);
    const surfaces = JSON.stringify([h.received, h.logs.map((input) => buildOperationalLogRecord(input)), result.json]);
    expect(surfaces).not.toContain("sentinel-pii");
    expect(h.received[0].p_tag_status).toBe("invalid");
  });
});

describe("7.3B receipt outcomes and failures (S-20, S-24, S-26)", () => {
  it.each(["recorded", "duplicate", "conflict"] as const)("S-20: %s → 200 only after the RPC returned", async (outcome) => {
    const h = harness();
    h.setResult({ result: outcome });
    const result = await deliver(h);
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ received: true });
    expect(h.logs).toMatchObject([{ event: `email_webhook.${outcome}`, outcome }]);
  });

  it("S-24: database unavailable → 503; any other RPC error or unexpected result → 500", async () => {
    const cases: Array<[unknown, number, string]> = [
      [Object.assign(new Error("connection"), { code: "08006" }), 503, "db_unavailable"],
      [new TypeError("fetch failed"), 503, "network_error"],
      [new Error("Environment configuration error: SUPABASE_SERVICE_ROLE_KEY is required."), 503, "config_missing"],
      [Object.assign(new Error("check"), { code: "23514" }), 500, "db_constraint"],
      [Object.assign(new Error("retry"), { code: "40001" }), 500, "db_claim_not_current"],
      [Object.assign(new Error("injected"), { code: "XX000" }), 500, "db_error"],
    ];
    for (const [error, status, code] of cases) {
      const h = harness();
      h.setResult(error instanceof Error ? error : new Error(String(error)));
      const result = await deliver(h);
      expect(result.status, code).toBe(status);
      expect(h.logs).toMatchObject([{ event: "email_webhook.failed", errorCode: code }]);
    }
    for (const value of [null, {}, { result: "stored" }, "recorded"]) {
      const h = harness();
      h.setResult(value);
      expect((await deliver(h)).status).toBe(500);
    }
  });

  it("S-26: a logger that throws everywhere changes no response or receipt", async () => {
    const throwing = () => {
      throw new Error("sink down");
    };
    const ok = harness({ deps: { log: throwing } });
    expect((await deliver(ok)).status).toBe(200);
    expect(ok.received).toHaveLength(1);
    const refused = harness({ current: null, deps: { log: throwing } });
    expect((await deliver(refused)).status).toBe(503);
    const failed = harness({ deps: { log: throwing } });
    failed.setResult(Object.assign(new Error("down"), { code: "08006" }));
    expect((await deliver(failed)).status).toBe(503);
  });
});

describe("7.3B logging (S-29, EC-6)", () => {
  const V2_KEYS = ["application_id", "attempt", "correlation_id", "duration_ms", "env", "error_code", "event", "level", "mode",
    "outcome", "release", "route", "schema", "source_id", "source_kind", "ts"];

  it("every receiver line is v2 with exactly the 16 keys and null source fields", () => {
    const events = ["refused", "rejected", "recorded", "duplicate", "conflict", "failed"] as const;
    const levels = { refused: "warn", rejected: "warn", recorded: "info", duplicate: "info", conflict: "warn", failed: "error" };
    for (const name of events) {
      const record = buildOperationalLogRecord({
        event: `email_webhook.${name}`, route: "resend_webhook", correlationId: "6f1c2a8e-0000-4000-8000-000000000001",
        outcome: name === "rejected" || name === "refused" || name === "failed" ? name === "rejected" ? "recorded" : name : name,
      });
      expect(Object.keys(record).sort()).toEqual(V2_KEYS);
      expect(record).toMatchObject({ schema: "mercurius.oplog.v2", event: `email_webhook.${name}`, route: "resend_webhook",
        level: levels[name], source_kind: null, source_id: null });
    }
    for (const code of ["webhook_headers_invalid", "webhook_payload_too_large", "webhook_payload_invalid_encoding",
      "webhook_signature_invalid", "webhook_payload_invalid"] as const) {
      expect(buildOperationalLogRecord({ event: "email_webhook.refused", route: "resend_webhook", correlationId: "x", errorCode: code }).error_code).toBe(code);
    }
  });

  it("S-29: secret, signature, secret slot, svix-id and email ID never reach a log line", async () => {
    const previous = newSecret();
    const h = harness({ previous });
    const id = "msg_logcheck_unique_42";
    const timestamp = nowSeconds();
    const body = bytes(event({}, { email_id: "em-logcheck-unique-99", tags: { mm_ledger: "owner_email", mm_ref: "0b5c1f7e-3a4d-4e2b-9c8d-1f2e3a4b5c6d", mm_attempt: "1" } }));
    const signature = sign(previous, id, timestamp, body);
    await deliver(h, { body, id, timestamp, signature });
    await deliver(h, { body, id, timestamp, signature: "v1,bad" });
    const lines = JSON.stringify(h.logs.map((input) => buildOperationalLogRecord(input)));
    for (const secretish of [h.current, previous, h.current.slice(6), previous.slice(6), signature.slice(3), id, "em-logcheck-unique-99",
      "0b5c1f7e", "previous", "owner_email", "email.delivered"]) {
      expect(lines, secretish).not.toContain(secretish);
    }
  });
});

describe("7.3B contract with the migration", () => {
  it("the RPC arguments are exactly the receive function's parameters", async () => {
    const sql = readFileSync("supabase/migrations/20261124001000_phase7_email_provider_events.sql", "utf8");
    const signature = sql.match(/create function public\.email_receive_provider_event\(([\s\S]*?)\) returns jsonb/)?.[1] ?? "";
    const names = [...signature.matchAll(/(p_[a-z_]+)\s/g)].map((match) => match[1]);
    const h = harness();
    await deliver(h);
    expect(Object.keys(h.received[0])).toEqual(names);
    expect(names).toHaveLength(13);
  });

  it("the migration bounds its locks and resets the session settings it changes", () => {
    const sql = readFileSync("supabase/migrations/20261124001000_phase7_email_provider_events.sql", "utf8");
    const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    expect(code.indexOf("set lock_timeout = '2s';")).toBeLessThan(code.indexOf("create table private.email_provider_events"));
    const ledgerIndexes = [...code.matchAll(/create index (\w+_provider_message_id)/g)].map((match) => match.index ?? -1);
    expect(ledgerIndexes).toHaveLength(3);
    const timeout = code.indexOf("set statement_timeout = '5s';");
    expect(timeout).toBeGreaterThan(code.lastIndexOf("grant execute"));
    for (const position of ledgerIndexes) expect(position).toBeGreaterThan(timeout);
    expect(code.trimEnd().endsWith("reset statement_timeout;\nreset lock_timeout;")).toBe(true);
    expect(code).not.toMatch(/concurrently/i);
  });
});

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  return () => vi.restoreAllMocks();
});

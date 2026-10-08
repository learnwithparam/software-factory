// GitHub webhooks as a faster trigger than the poll. A delivery only wakes
// the watcher; the poll still reads every label and comment itself, so a
// forged or replayed event can at worst cause one extra poll, and a lost one
// costs at most pollIntervalSeconds. The HMAC is checked before anything is
// read, against FACTORY_WEBHOOK_SECRET; with no secret set the route is off.

import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_SECRET_ENV = "FACTORY_WEBHOOK_SECRET";
// A delivery larger than this is refused before it is hashed.
export const WEBHOOK_MAX_BYTES = 1024 * 1024;

// The events that can move an issue: a label, a comment, a review, a merge.
export const WAKING_EVENTS: ReadonlySet<string> = new Set(["issues", "issue_comment", "pull_request", "pull_request_review", "pull_request_review_comment", "check_suite"]);

export function signatureOf(secret: string, body: string | Uint8Array): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// GitHub's X-Hub-Signature-256: "sha256=" and the hex HMAC of the raw body.
export function signatureMatches(secret: string, body: Uint8Array, header: string | null): boolean {
  if (!secret || !header) return false;
  const want = Buffer.from(signatureOf(secret, body));
  const got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface Delivery {
  readonly id: string;
  readonly event: string;
  readonly action: string;
  readonly repo: string;
}

export function readDelivery(headers: Headers, payload: unknown): Delivery | undefined {
  const id = headers.get("x-github-delivery") ?? "";
  const event = headers.get("x-github-event") ?? "";
  const p = (payload ?? {}) as { action?: unknown; repository?: { full_name?: unknown } };
  const repo = typeof p.repository?.full_name === "string" ? p.repository.full_name : "";
  if (!/^[\w-]{1,64}$/.test(id) || !/^[a-z_]{1,64}$/.test(event)) return undefined;
  return { id, event, action: typeof p.action === "string" ? p.action.slice(0, 64) : "", repo };
}

/**
 * patient-sync/1 signature scheme — identical on both sides of the bridge.
 *
 * HMAC-SHA256 over `v1:<timestamp>:<nonce>:` + the RAW request bytes, keyed
 * by a rotatable secret identified by a key id. Verification resolves the
 * secret by key id, enforces the timestamp tolerance window, and compares
 * with a CONSTANT-TIME comparison — all BEFORE any body parsing. Nothing
 * here logs or returns body content or secrets.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-sync-signature";
export const KEY_ID_HEADER = "x-sync-key-id";
export const TIMESTAMP_HEADER = "x-sync-timestamp";
export const NONCE_HEADER = "x-sync-nonce";

export class SignatureViolation extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SignatureViolation";
    this.code = code;
  }
}

export function signRequest(opts: {
  rawBody: Buffer | Uint8Array;
  secret: string;
  timestamp: number | string;
  nonce: string;
}): string {
  const h = createHmac("sha256", opts.secret);
  h.update(`v1:${opts.timestamp}:${opts.nonce}:`, "utf8");
  h.update(opts.rawBody);
  return h.digest("hex");
}

/** Throws SignatureViolation on any failure; returns true on success. */
export function verifyRequest(opts: {
  rawBody: Buffer | Uint8Array;
  signature: string | null | undefined;
  keyId: string | null | undefined;
  timestamp: string | null | undefined;
  nonce: string | null | undefined;
  resolveSecret: (keyId: string) => string | null;
  nowMs?: number;
  toleranceMs?: number;
}): true {
  const { signature, keyId, timestamp, nonce } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const toleranceMs = opts.toleranceMs ?? 5 * 60_000;
  if (!signature || !keyId || !timestamp || !nonce) {
    throw new SignatureViolation("missing_signature_headers", "signature headers missing");
  }
  const secret = opts.resolveSecret(keyId);
  if (!secret) {
    throw new SignatureViolation("unknown_key_id", "key id is not recognized");
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > toleranceMs) {
    throw new SignatureViolation("timestamp_outside_tolerance", "timestamp outside tolerance");
  }
  const expected = signRequest({ rawBody: opts.rawBody, secret, timestamp, nonce });
  const a = Buffer.from(expected, "hex");
  const b = /^[0-9a-f]+$/i.test(signature) && signature.length === expected.length
    ? Buffer.from(signature, "hex")
    : null;
  if (!b || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new SignatureViolation("invalid_signature", "signature is invalid");
  }
  return true;
}

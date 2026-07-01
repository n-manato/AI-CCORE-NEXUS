import crypto from "crypto";
import { encryptSecret, hashKey } from "@/lib/crypto";

export const API_KEY_PREFIX = "lag_"; // Local AI Gateway

export interface GeneratedKey {
  raw: string; // full key, shown once on creation / on explicit reveal
  keyHash: string;
  keyEncrypted: string;
  keyPrefix: string; // e.g. "lag_ab12"
  last4: string;
}

// Generates a new opaque API key and the values to persist for it.
export function generateApiKey(): GeneratedKey {
  const body = crypto.randomBytes(24).toString("base64url"); // 32 url-safe chars
  const raw = `${API_KEY_PREFIX}${body}`;
  return {
    raw,
    keyHash: hashKey(raw),
    keyEncrypted: encryptSecret(raw),
    keyPrefix: raw.slice(0, 8),
    last4: raw.slice(-4),
  };
}

// Masked form for display when the full key should not be revealed.
export function maskKey(prefix: string, last4: string): string {
  return `${prefix}${"•".repeat(8)}${last4}`;
}

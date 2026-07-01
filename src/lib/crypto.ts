import crypto from "crypto";

// AES-256-GCM encryption for API keys at rest. The encryption key comes from the
// environment (API_KEY_ENC_KEY), never from the database. Never log decrypted keys.

function getKey(): Buffer {
  const hex = process.env.API_KEY_ENC_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "API_KEY_ENC_KEY must be a 64-char hex string (32 bytes). See .env.example.",
    );
  }
  return Buffer.from(hex, "hex");
}

// Returns "iv:authTag:ciphertext", all hex-encoded.
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) {
    throw new Error("Malformed encrypted payload");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

// One-way hash used for fast, constant-target lookup of an API key on requests.
export function hashKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// Constant-time comparison helper.
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

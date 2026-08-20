import dns from "node:dns/promises";
import net from "node:net";

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 30_000;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

export class ResponseImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponseImageError";
  }
}

function maxImageBytes(): number {
  const configured = Number(process.env.AICCORE_MAX_IMAGE_BYTES);
  return Number.isFinite(configured) && configured >= 1024 && configured <= 100 * 1024 * 1024
    ? Math.floor(configured)
    : DEFAULT_MAX_IMAGE_BYTES;
}

function normalizedMime(value: string | null | undefined): string | null {
  const mime = (value ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (!IMAGE_TYPES.has(mime)) return null;
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && (new TextDecoder().decode(bytes.slice(0, 6)) === "GIF87a" || new TextDecoder().decode(bytes.slice(0, 6)) === "GIF89a")) return "image/gif";
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

function asDataUrl(bytes: Uint8Array, declaredMime?: string | null): string {
  if (bytes.byteLength === 0 || bytes.byteLength > maxImageBytes()) {
    throw new ResponseImageError(`Image exceeds the ${maxImageBytes()} byte limit.`);
  }
  const sniffed = sniffMime(bytes);
  const mime = normalizedMime(declaredMime) ?? sniffed;
  if (!mime || !sniffed || mime !== sniffed) throw new ResponseImageError("Only valid PNG, JPEG, GIF, or WebP images are supported.");
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b! >= 64 && b! <= 127) || (a === 169 && b === 254) || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168) || a! >= 224;
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("ff");
  }
  return true;
}

async function assertSafeRemoteUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ResponseImageError("Image URL is invalid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new ResponseImageError("Image URL must use HTTP or HTTPS.");
  if (url.username || url.password) throw new ResponseImageError("Image URL credentials are not allowed.");
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new ResponseImageError("Image URL resolves to a private or local address.");
  return url;
}

async function readLimited(response: Response): Promise<Uint8Array> {
  const limit = maxImageBytes();
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) throw new ResponseImageError(`Image exceeds the ${limit} byte limit.`);
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) throw new ResponseImageError(`Image exceeds the ${limit} byte limit.`);
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchRemoteImage(raw: string): Promise<string> {
  let current = raw;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const url = await assertSafeRemoteUrl(current);
    const response = await fetch(url, {
      redirect: "manual",
      headers: { Accept: "image/png,image/jpeg,image/webp,image/gif", "User-Agent": "AI-CCORE-Gateway/1.0" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new ResponseImageError("Image URL has too many redirects.");
      current = new URL(location, url).toString();
      continue;
    }
    if (!response.ok) throw new ResponseImageError(`Image URL returned HTTP ${response.status}.`);
    const bytes = await readLimited(response);
    return asDataUrl(bytes, response.headers.get("content-type"));
  }
  throw new ResponseImageError("Image URL could not be fetched.");
}

export async function normalizeImageUrl(value: unknown): Promise<string> {
  const raw = typeof value === "string" ? value : value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string" ? (value as { url: string }).url : "";
  if (!raw) throw new ResponseImageError("input_image requires an image_url.");
  if (raw.startsWith("data:")) {
    const match = raw.match(/^data:([^;,]+);base64,(.*)$/s);
    if (!match) throw new ResponseImageError("Only base64 image Data URLs are supported.");
    const encoded = match[2]!.replace(/\s/g, "");
    if (encoded.length > Math.ceil((maxImageBytes() * 4) / 3) + 16) throw new ResponseImageError(`Image exceeds the ${maxImageBytes()} byte limit.`);
    const bytes = Buffer.from(encoded, "base64");
    return asDataUrl(bytes, match[1]);
  }
  try {
    return await fetchRemoteImage(raw);
  } catch (error) {
    if (error instanceof ResponseImageError) throw error;
    throw new ResponseImageError("Image URL could not be fetched.");
  }
}

export type ChatImageContent = { type: "image_url"; image_url: { url: string } };

export async function normalizeResponsesImages(input: unknown): Promise<unknown> {
  if (!Array.isArray(input)) return input;
  const convertContent = async (content: unknown): Promise<unknown> => {
    if (!Array.isArray(content)) return content;
    const out: unknown[] = [];
    for (const raw of content) {
      if (!raw || typeof raw !== "object") {
        out.push(raw);
        continue;
      }
      const part = raw as Record<string, unknown>;
      if (part.type === "input_text") out.push({ type: "text", text: typeof part.text === "string" ? part.text : "" });
      else if (part.type === "input_image") out.push({ type: "image_url", image_url: { url: await normalizeImageUrl(part.image_url) } } satisfies ChatImageContent);
      else out.push(raw);
    }
    return out;
  };
  const out: unknown[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      out.push(raw);
      continue;
    }
    const item = raw as Record<string, unknown>;
    if (item.type === "message") out.push({ ...item, content: await convertContent(item.content) });
    else if (item.type === "input_image") out.push({ type: "message", role: "user", content: [{ type: "image_url", image_url: { url: await normalizeImageUrl(item.image_url) } }] });
    else out.push(raw);
  }
  return out;
}

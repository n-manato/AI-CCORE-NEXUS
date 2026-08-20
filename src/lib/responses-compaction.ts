// Stateless context compaction for the Responses API.  This module deliberately
// has no model/tokenizer dependency: the gateway must remain usable when the
// configured model is the only model that fits in VRAM.

export interface ContextPolicy {
  hardContextLimit: number;
  compactTrigger: number;
  compactTarget: number;
  outputReserve: number;
  reasoningReserve: number;
  safetyMargin: number;
  recentContextToKeep: number;
  summaryTarget: number;
  maxSingleToolOutputTokens: number;
  tokenEstimateSafetyMultiplier: number;
}

export const DEFAULT_RESPONSE_POLICY: ContextPolicy = {
  hardContextLimit: 65536,
  compactTrigger: 42000,
  compactTarget: 28000,
  outputReserve: 8192,
  reasoningReserve: 4096,
  safetyMargin: 4096,
  recentContextToKeep: 12000,
  summaryTarget: 4000,
  maxSingleToolOutputTokens: 3500,
  tokenEstimateSafetyMultiplier: 1.15,
};

const POLICIES: Record<string, Partial<ContextPolicy>> = {
  "qwen3.6-27b": {},
  "qwen3.6-27b:Q8_0": {},
  "qwen3.6:27b-Q8_0": {},
};

function configuredPolicies(): Record<string, Partial<ContextPolicy>> {
  const raw = process.env.AICCORE_RESPONSE_CONTEXT_POLICIES;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, Partial<ContextPolicy>> : {};
  } catch {
    return {};
  }
}

type Obj = Record<string, unknown>;
export type ResponsesItem = Obj | string;

export interface CompactionStats {
  compacted: boolean;
  beforeTokens: number;
  afterTokens: number;
  toolOutputsCompacted: number;
  itemsRemoved: number;
}

export interface ResponsesCompactionInput {
  model: string;
  input: string | ResponsesItem[];
  instructions?: string;
  tools?: unknown[];
  /** Optional client declaration of the actual loaded model context window. */
  context_length?: number;
  model_context_size?: number;
  context_window?: number;
  max_context_tokens?: number;
  [key: string]: unknown;
}

export interface ResponsesCompactionResult {
  body: ResponsesCompactionInput;
  stats: CompactionStats;
}

export function responsePolicy(model: string, declaredContext?: number, requestedOutput?: number): ContextPolicy {
  const override = { ...(POLICIES[model] ?? {}), ...(configuredPolicies()[model] ?? {}) };
  const policy = { ...DEFAULT_RESPONSE_POLICY, ...override };
  if (Number.isFinite(declaredContext) && declaredContext && declaredContext >= 4096 && declaredContext <= 1_000_000) {
    policy.hardContextLimit = Math.floor(declaredContext);
  }
  if (Number.isFinite(requestedOutput) && requestedOutput && requestedOutput > policy.outputReserve) {
    policy.outputReserve = Math.floor(requestedOutput);
  }
  const effective = policy.hardContextLimit - policy.outputReserve - policy.reasoningReserve - policy.safetyMargin;
  policy.compactTrigger = Math.min(policy.compactTrigger, Math.max(0, effective));
  policy.compactTarget = Math.min(policy.compactTarget, Math.max(0, effective));
  return policy;
}

function cjkCount(text: string): number {
  const m = text.match(/[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/g);
  return m ? m.length : 0;
}

/** Conservative, replaceable token-counter abstraction. */
export const TokenCounter = {
  countText(text: string, policy: ContextPolicy = DEFAULT_RESPONSE_POLICY): number {
    const cjk = cjkCount(text);
    const rest = text.length - cjk;
    return Math.ceil((cjk + rest / 3.5) * policy.tokenEstimateSafetyMultiplier);
  },
  countItem(item: unknown, policy: ContextPolicy = DEFAULT_RESPONSE_POLICY): number {
    return TokenCounter.countText(JSON.stringify(countableValue(item)) ?? "", policy) + 4;
  },
  countRequest(body: Pick<ResponsesCompactionInput, "input" | "instructions" | "tools">, policy: ContextPolicy = DEFAULT_RESPONSE_POLICY): number {
    return TokenCounter.countText(JSON.stringify(countableValue({ instructions: body.instructions, input: body.input, tools: body.tools })) ?? "", policy);
  },
};

// Image bytes/Data URLs are not sent as prompt text by the Ollama adapter. Count
// them as a bounded multimodal item so a Base64 payload cannot trigger false
// context overflow or force the compactor to discard the image.
function countableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(countableValue);
  if (!value || typeof value !== "object") return value;
  const object = value as Obj;
  if (object.type === "input_image" || object.type === "image_url") {
    return { type: object.type, image_url: "[image payload]" };
  }
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, countableValue(item)]));
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join("\n");
  if (typeof value === "object") {
    const o = value as Obj;
    if (o.type === "input_image" || o.type === "image_url") return "[image input omitted from compacted text]";
    if (typeof o.text === "string") return o.text;
    if (typeof o.output_text === "string") return o.output_text;
  }
  return JSON.stringify(value) ?? "";
}

function roleOf(item: ResponsesItem): string {
  return typeof item === "object" && typeof item.role === "string" ? item.role : "";
}

function typeOf(item: ResponsesItem): string {
  return typeof item === "object" && typeof item.type === "string" ? item.type : "";
}

function callIdOf(item: ResponsesItem): string {
  if (typeof item !== "object") return "";
  return String(item.call_id ?? item.id ?? "");
}

function isToolCall(item: ResponsesItem): boolean {
  return typeOf(item) === "function_call";
}

function isToolOutput(item: ResponsesItem): boolean {
  return typeOf(item) === "function_call_output";
}

function isUser(item: ResponsesItem): boolean {
  return typeOf(item) === "message" && roleOf(item) === "user";
}

function isProtectedInstruction(item: ResponsesItem): boolean {
  return typeOf(item) === "message" && (roleOf(item) === "system" || roleOf(item) === "developer");
}

function shortEdge(text: string, chars: number): string {
  if (text.length <= chars * 2) return text;
  return `${text.slice(0, chars)}\n...[middle omitted]...\n${text.slice(-chars)}`;
}

function redactSensitive(text: string): string {
  return text
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,]+/gi, "$1[REDACTED]")
    .replace(/(bearer\s+)(lag_[A-Za-z0-9._-]+)/gi, "$1[REDACTED]")
    .replace(/(["']?(?:api[_-]?key|auth[_-]?secret|password|token)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, "$1[REDACTED]");
}

function compactToolOutput(item: ResponsesItem, policy: ContextPolicy): ResponsesItem {
  if (!isToolOutput(item) || typeof item !== "object") return item;
  const raw = textOf(item.output);
  if (TokenCounter.countText(raw, policy) <= policy.maxSingleToolOutputTokens) return item;
  const edgeTokens = Math.max(100, Math.floor(policy.maxSingleToolOutputTokens * 0.38));
  const chars = Math.max(200, Math.floor((edgeTokens * 3.5) / policy.tokenEstimateSafetyMultiplier));
  const originalTokens = TokenCounter.countText(raw, policy);
  const preserved = shortEdge(raw, chars);
  const output = typeof item.output === "object" && item.output !== null
    ? {
        _gateway_compacted: true,
        original_estimated_tokens: originalTokens,
        preserved_beginning_and_end: preserved,
      }
    : `[Tool output compacted by AI-CCORE Gateway]\nOriginal estimated size: ${originalTokens.toLocaleString()} tokens\nPreserved beginning and ending sections. Middle section omitted because it consisted of verbose build or command output.\n\n${preserved}`;
  const compacted = {
    ...item,
    output,
  };
  return compacted;
}

function summaryFor(items: ResponsesItem[], policy: ContextPolicy): string {
  const lines = items.map((item) => {
    const type = typeOf(item) || "opaque";
    const role = roleOf(item) || "unknown";
    const text = redactSensitive(shortEdge(textOf(item), 420));
    return `- [${role}/${type}] ${text}`;
  });
  const sections = [
    "COMPACTED SESSION STATE",
    "\nProject and objective:\n- Preserve the current coding task and continue from the recent request.",
    "\nCurrent user request:\n- See the protected recent conversation below.",
    "\nCompleted work:\n- Earlier conversation was compacted; details are represented by the retained event notes.",
    "\nFiles created or modified:\n- Refer to retained command output and recent conversation for exact paths.",
    "\nImportant technical decisions:\n- Tool calls and outputs were kept atomic; call IDs were not changed.",
    "\nCommands and validations already run:\n- Earlier verbose output may be truncated at its edges.",
    "\nKnown failures and error messages:\n- Preserve any error lines present in the retained notes.",
    "\nPending work:\n- Continue the latest incomplete task.",
    "\nConstraints that must continue to be followed:\n- Preserve system/developer instructions, current user request, and tool-call pairing.",
    `\nRetained older event notes (target ${policy.summaryTarget} tokens):\n${lines.join("\n")}`,
  ];
  const out = sections.join("\n");
  const maxChars = Math.floor((policy.summaryTarget * 3.5) / policy.tokenEstimateSafetyMultiplier);
  return out.length > maxChars ? `${out.slice(0, maxChars)}\n[summary truncated]` : out;
}

function atomicGroups(items: ResponsesItem[]): number[][] {
  const groups: number[][] = [];
  const byCall = new Map<string, number>();
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const id = callIdOf(item);
    if (isToolCall(item) && id) {
      const group = [i];
      groups.push(group);
      byCall.set(id, groups.length - 1);
    } else if (isToolOutput(item) && id && byCall.has(id)) {
      groups[byCall.get(id)!]!.push(i);
    } else {
      groups.push([i]);
    }
  }
  return groups;
}

function compactItems(items: ResponsesItem[], policy: ContextPolicy): { items: ResponsesItem[]; stats: CompactionStats } {
  const before = items.reduce((n, x) => n + TokenCounter.countItem(x, policy), 0);
  let working = items.map((item) => compactToolOutput(item, policy));
  const compactedTools = working.filter((x, i) => x !== items[i] && isToolOutput(x)).length;
  const protectedIndexes = new Set<number>();
  working.forEach((item, i) => {
    if (isProtectedInstruction(item)) protectedIndexes.add(i);
  });
  // The final user request is never summarized, even when it is itself larger
  // than the recent-context soft budget.
  const currentUserIndex = [...working].map((item, i) => (isUser(item) ? i : -1)).findLast((i) => i >= 0);
  if (currentUserIndex !== undefined && currentUserIndex >= 0) protectedIndexes.add(currentUserIndex);
  // Always retain the current user request, and retain a suffix by atomic group.
  let recentTokens = 0;
  const groups = atomicGroups(working);
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const group = groups[gi]!;
    const groupTokens = group.reduce((n, i) => n + TokenCounter.countItem(working[i], policy), 0);
    if (recentTokens >= policy.recentContextToKeep && !group.some((i) => isUser(working[i]!))) break;
    group.forEach((i) => protectedIndexes.add(i));
    recentTokens += groupTokens;
  }
  // Pending calls are protected even when they are old: an output can arrive later.
  working.forEach((item, i) => {
    if (isToolCall(item) && !working.some((x) => isToolOutput(x) && callIdOf(x) === callIdOf(item))) protectedIndexes.add(i);
  });
  const old = working.filter((_, i) => !protectedIndexes.has(i));
  const currentTotal = TokenCounter.countRequest({ input: working }, policy);
  if (!old.length || currentTotal <= policy.compactTrigger) {
    return { items: working, stats: { compacted: compactedTools > 0, beforeTokens: before, afterTokens: TokenCounter.countRequest({ input: working }, policy), toolOutputsCompacted: compactedTools, itemsRemoved: 0 } };
  }
  const summaryItem: ResponsesItem = {
    type: "message",
    role: "developer",
    content: [{ type: "input_text", text: summaryFor(old, policy) }],
  };
  const kept = working.filter((_, i) => protectedIndexes.has(i));
  // Preserve original order around the summary: instructions, summary, then suffix.
  const firstNonInstruction = kept.findIndex((item) => !isProtectedInstruction(item));
  const insertion = firstNonInstruction < 0 ? kept.length : firstNonInstruction;
  const output = [...kept.slice(0, insertion), summaryItem, ...kept.slice(insertion)];
  const after = TokenCounter.countRequest({ input: output }, policy);
  return { items: output, stats: { compacted: true, beforeTokens: before, afterTokens: after, toolOutputsCompacted: compactedTools, itemsRemoved: old.length } };
}

export function compactResponsesRequest(input: ResponsesCompactionInput, options: { force?: boolean } = {}): ResponsesCompactionResult {
  const declared = input.context_length ?? input.model_context_size ?? input.context_window ?? input.max_context_tokens;
  const policy = responsePolicy(input.model, declared, typeof input.max_output_tokens === "number" ? input.max_output_tokens : undefined);
  const before = TokenCounter.countRequest(input, policy);
  if (!Array.isArray(input.input) || (!options.force && before <= policy.compactTrigger)) {
    return { body: input, stats: { compacted: false, beforeTokens: before, afterTokens: before, toolOutputsCompacted: 0, itemsRemoved: 0 } };
  }
  const result = compactItems(input.input, policy);
  const body = { ...input, input: result.items };
  return { body, stats: { ...result.stats, beforeTokens: before, afterTokens: TokenCounter.countRequest(body, policy) } };
}

export function contextLengthBudget(model: string): number {
  const p = responsePolicy(model);
  return p.hardContextLimit - p.outputReserve - p.reasoningReserve - p.safetyMargin;
}

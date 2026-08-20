import assert from "node:assert/strict";
import { compactResponsesRequest, TokenCounter, type ResponsesItem } from "../src/lib/responses-compaction";

const oldOutput = "build output ".repeat(5000);
const input = [
  { type: "message", role: "system", content: [{ type: "input_text", text: "Never lose this instruction." }] },
  { type: "message", role: "user", content: [{ type: "input_text", text: "old request" }] },
  { type: "function_call", id: "fc_old", call_id: "call_old", name: "shell", arguments: '{"cmd":"build"}' },
  { type: "function_call_output", call_id: "call_old", output: oldOutput },
  ...Array.from({ length: 80 }, (_, i) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text: `old turn ${i} ${"detail ".repeat(400)}` }] })),
  { type: "message", role: "user", content: [{ type: "input_text", text: "current request must remain verbatim" }] },
];

const result = compactResponsesRequest({ model: "qwen3.6-27b:Q8_0", input });
const compactedItems = result.body.input as ResponsesItem[];
assert.equal(result.stats.compacted, true);
assert.ok(result.stats.afterTokens < result.stats.beforeTokens);
assert.ok(compactedItems.some((item) => typeof item === "object" && item.type === "message" && item.role === "system"));
assert.ok(compactedItems.some((item) => JSON.stringify(item).includes("current request must remain verbatim")));
const calls = compactedItems.filter((item) => typeof item === "object" && (item.type === "function_call" || item.type === "function_call_output"));
assert.equal(calls.filter((item) => (item as { type: string }).type === "function_call").length, calls.filter((item) => (item as { type: string }).type === "function_call_output").length);
assert.ok(result.stats.toolOutputsCompacted >= 1);
assert.ok(TokenCounter.countRequest(result.body) < 49152);
console.log("responses compaction tests passed", result.stats);

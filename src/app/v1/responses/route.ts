import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  classifyBackendError,
  corsHeaders,
  errorStatus,
  gateRequest,
  gatewayError,
  isTimeoutError,
  recordUsage,
} from "@/lib/gateway";
import {
  appIdToTag,
  OllamaError,
  ollamaChat,
  ollamaChatStream,
  toAppId,
} from "@/lib/ollama";
import { logGatewayError } from "@/lib/gateway-log";
import { compactResponsesRequest, type ResponsesCompactionInput } from "@/lib/responses-compaction";
import { normalizeResponsesImages, ResponseImageError } from "@/lib/responses-images";

export const dynamic = "force-dynamic";

const PATH = "/v1/responses";

const Body = z
  .object({
    model: z.string().min(1),
    input: z.union([z.string(), z.array(z.any())]),
    instructions: z.string().optional(),
    tools: z.array(z.any()).optional(),
    tool_choice: z.any().optional(),
    stream: z.boolean().optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    context_length: z.number().int().positive().optional(),
    model_context_size: z.number().int().positive().optional(),
    context_window: z.number().int().positive().optional(),
    max_context_tokens: z.number().int().positive().optional(),
  })
  .passthrough();

type Json = Record<string, unknown>;

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const p = part as Json;
      if (typeof p.text === "string") return p.text;
      if (p.type === "input_image" || p.type === "image_url") return "[image input]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function responsesContentToChat(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.flatMap((raw) => {
    if (typeof raw === "string") return [{ type: "text", text: raw }];
    if (!raw || typeof raw !== "object") return [];
    const part = raw as Json;
    if (part.type === "input_text" || part.type === "text" || part.type === "output_text") {
      return [{ type: "text", text: typeof part.text === "string" ? part.text : "" }];
    }
    if (part.type === "input_image") {
      return [{ type: "image_url", image_url: { url: part.image_url } }];
    }
    if (part.type === "image_url" && part.image_url) return [part];
    return [part];
  });
}

function responsesInputToMessages(input: string | unknown[], instructions?: string): Json[] {
  const messages: Json[] = [];
  if (instructions) messages.push({ role: "system", content: instructions });
  if (typeof input === "string") {
    messages.push({ role: "user", content: input });
    return messages;
  }

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Json;
    if (item.type === "message") {
      const role = item.role === "developer" ? "system" : item.role;
      const content = responsesContentToChat(item.content);
      messages.push({ role: typeof role === "string" ? role : "user", content: Array.isArray(content) && content.length ? content : textFromContent(item.content) });
      continue;
    }
    if (item.type === "input_image") {
      messages.push({ role: "user", content: responsesContentToChat([item]) });
      continue;
    }
    if (item.type === "function_call") {
      const toolCall = {
        id: String(item.call_id ?? item.id ?? `call_${randomUUID()}`),
        type: "function",
        function: {
          name: String(item.name ?? ""),
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments ?? {}),
        },
      };
      const previous = messages.at(-1);
      if (previous?.role === "assistant" && Array.isArray(previous.tool_calls)) {
        previous.tool_calls.push(toolCall);
      } else {
        messages.push({
          role: "assistant",
          content: "",
          tool_calls: [toolCall],
        });
      }
      continue;
    }
    if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: String(item.call_id ?? ""),
        content: textFromContent(item.output),
      });
    }
  }
  return messages;
}

function responsesToolsToChat(tools: unknown[] | undefined): Json[] | undefined {
  const converted = (tools ?? []).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const t = raw as Json;
    if (t.type !== "function" || typeof t.name !== "string") return [];
    return [
      {
        type: "function",
        function: {
          name: t.name,
          description: typeof t.description === "string" ? t.description : undefined,
          parameters: t.parameters && typeof t.parameters === "object" ? t.parameters : { type: "object", properties: {} },
        },
      },
    ];
  });
  return converted.length ? converted : undefined;
}

function toolChoiceToChat(choice: unknown): unknown {
  if (!choice || typeof choice === "string") return choice;
  if (typeof choice !== "object") return undefined;
  const c = choice as Json;
  if (c.type === "function" && typeof c.name === "string") {
    return { type: "function", function: { name: c.name } };
  }
  return undefined;
}

function toChatBody(body: z.infer<typeof Body>, tag: string): Json {
  return {
    model: tag,
    messages: responsesInputToMessages(body.input, body.instructions),
    tools: responsesToolsToChat(body.tools),
    tool_choice: toolChoiceToChat(body.tool_choice),
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_output_tokens,
  };
}

function usageFromChat(value: unknown): Json {
  const u = value && typeof value === "object" ? (value as Json) : {};
  const input = Number(u.prompt_tokens ?? 0);
  const output = Number(u.completion_tokens ?? 0);
  return { input_tokens: input, output_tokens: output, total_tokens: Number(u.total_tokens ?? input + output) };
}

function baseResponse(id: string, model: string, createdAt: number): Json {
  return {
    id,
    object: "response",
    created_at: createdAt,
    status: "in_progress",
    error: null,
    incomplete_details: null,
    instructions: null,
    max_output_tokens: null,
    model,
    output: [],
    parallel_tool_calls: true,
    previous_response_id: null,
    reasoning: { effort: null, summary: null },
    store: false,
    temperature: null,
    text: { format: { type: "text" } },
    tool_choice: "auto",
    tools: [],
    top_p: null,
    truncation: "disabled",
    usage: null,
    user: null,
    metadata: {},
  };
}

function chatResultToResponse(result: Json, requestedModel: string): Json {
  const responseId = `resp_${randomUUID().replaceAll("-", "")}`;
  const createdAt = Number(result.created ?? Math.floor(Date.now() / 1000));
  const choice = Array.isArray(result.choices) ? (result.choices[0] as Json | undefined) : undefined;
  const message = choice?.message && typeof choice.message === "object" ? (choice.message as Json) : {};
  const output: Json[] = [];
  const content = typeof message.content === "string" ? message.content : "";
  if (content || !Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
    output.push({
      id: `msg_${randomUUID().replaceAll("-", "")}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: content, annotations: [] }],
    });
  }
  for (const raw of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
    const tc = raw as Json;
    const fn = tc.function && typeof tc.function === "object" ? (tc.function as Json) : {};
    output.push({
      id: `fc_${randomUUID().replaceAll("-", "")}`,
      type: "function_call",
      status: "completed",
      call_id: String(tc.id ?? `call_${randomUUID()}`),
      name: String(fn.name ?? ""),
      arguments: String(fn.arguments ?? "{}"),
    });
  }
  return {
    ...baseResponse(responseId, requestedModel, createdAt),
    status: "completed",
    output,
    usage: usageFromChat(result.usage),
  };
}

function sseEvent(type: string, payload: Json): Uint8Array {
  return new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
}

interface ToolState {
  itemId: string;
  callId: string;
  name: string;
  arguments: string;
  announced: boolean;
  outputIndex: number;
}

function responsesStream(upstream: Response, requestedModel: string, release: () => void): ReadableStream<Uint8Array> {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  const responseId = `resp_${randomUUID().replaceAll("-", "")}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const response = baseResponse(responseId, requestedModel, createdAt);
  let sequence = 0;
  let buffer = "";
  let text = "";
  let messageId = "";
  let messageAnnounced = false;
  let usage: Json = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  const tools = new Map<number, ToolState>();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (type: string, payload: Json) => controller.enqueue(sseEvent(type, { ...payload, sequence_number: sequence++ }));
      const announceMessage = () => {
        if (messageAnnounced) return;
        messageAnnounced = true;
        messageId = `msg_${randomUUID().replaceAll("-", "")}`;
        const item = { id: messageId, type: "message", status: "in_progress", role: "assistant", content: [] };
        emit("response.output_item.added", { response_id: responseId, output_index: 0, item });
        emit("response.content_part.added", {
          response_id: responseId,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        });
      };
      const announceTool = (tool: ToolState) => {
        if (tool.announced || !tool.name) return;
        tool.announced = true;
        emit("response.output_item.added", {
          response_id: responseId,
          output_index: tool.outputIndex,
          item: {
            id: tool.itemId,
            type: "function_call",
            status: "in_progress",
            call_id: tool.callId,
            name: tool.name,
            arguments: "",
          },
        });
      };
      const consume = (raw: string) => {
        if (!raw || raw === "[DONE]") return;
        let chunk: Json;
        try {
          chunk = JSON.parse(raw) as Json;
        } catch {
          return;
        }
        if (chunk.usage) usage = usageFromChat(chunk.usage);
        const choice = Array.isArray(chunk.choices) ? (chunk.choices[0] as Json | undefined) : undefined;
        const delta = choice?.delta && typeof choice.delta === "object" ? (choice.delta as Json) : undefined;
        if (!delta) return;
        if (typeof delta.content === "string" && delta.content) {
          announceMessage();
          text += delta.content;
          emit("response.output_text.delta", {
            response_id: responseId,
            item_id: messageId,
            output_index: 0,
            content_index: 0,
            delta: delta.content,
          });
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const rawTool of delta.tool_calls) {
            const tc = rawTool as Json;
            const index = Number(tc.index ?? 0);
            let state = tools.get(index);
            if (!state) {
              state = {
                itemId: `fc_${randomUUID().replaceAll("-", "")}`,
                callId: String(tc.id ?? `call_${randomUUID().replaceAll("-", "")}`),
                name: "",
                arguments: "",
                announced: false,
                outputIndex: (messageAnnounced ? 1 : 0) + index,
              };
              tools.set(index, state);
            }
            const fn = tc.function && typeof tc.function === "object" ? (tc.function as Json) : {};
            if (typeof tc.id === "string") state.callId = tc.id;
            if (typeof fn.name === "string") state.name += fn.name;
            announceTool(state);
            if (typeof fn.arguments === "string" && fn.arguments) {
              state.arguments += fn.arguments;
              announceTool(state);
              if (state.announced) {
                emit("response.function_call_arguments.delta", {
                  response_id: responseId,
                  item_id: state.itemId,
                  output_index: state.outputIndex,
                  delta: fn.arguments,
                });
              }
            }
          }
        }
      };

      emit("response.created", { response });
      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.startsWith("data:")) consume(line.slice(5).trim());
            }
          }
          if (buffer.startsWith("data:")) consume(buffer.slice(5).trim());

          const output: Json[] = [];
          if (messageAnnounced || tools.size === 0) {
            announceMessage();
            emit("response.output_text.done", {
              response_id: responseId,
              item_id: messageId,
              output_index: 0,
              content_index: 0,
              text,
            });
            const part = { type: "output_text", text, annotations: [] };
            emit("response.content_part.done", {
              response_id: responseId,
              item_id: messageId,
              output_index: 0,
              content_index: 0,
              part,
            });
            const item = { id: messageId, type: "message", status: "completed", role: "assistant", content: [part] };
            emit("response.output_item.done", { response_id: responseId, output_index: 0, item });
            output.push(item);
          }
          for (const tool of [...tools.values()].sort((a, b) => a.outputIndex - b.outputIndex)) {
            announceTool(tool);
            emit("response.function_call_arguments.done", {
              response_id: responseId,
              item_id: tool.itemId,
              output_index: tool.outputIndex,
              arguments: tool.arguments,
            });
            const item = {
              id: tool.itemId,
              type: "function_call",
              status: "completed",
              call_id: tool.callId,
              name: tool.name,
              arguments: tool.arguments,
            };
            emit("response.output_item.done", { response_id: responseId, output_index: tool.outputIndex, item });
            output.push(item);
          }
          emit("response.completed", {
            response: { ...response, status: "completed", output, usage },
          });
        } catch (error) {
          emit("error", {
            code: "backend_error",
            message: (error as Error)?.message ?? "Upstream stream failed.",
            param: null,
          });
        } finally {
          release();
          try {
            controller.close();
          } catch {
            // Already closed by the client.
          }
        }
      })();
    },
    cancel(reason) {
      release();
      void reader.cancel(reason).catch(() => {});
    },
  });
}

export async function POST(req: Request) {
  const started = Date.now();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const requestedModel = parsed.success ? toAppId(parsed.data.model) : undefined;
  const gate = await gateRequest(req, PATH, requestedModel);
  if (!gate.ok) return gate.response;
  const usage = { userId: gate.auth.userId, apiName: gate.apiName, category: gate.category, path: PATH };

  if (!parsed.success) {
    gate.release();
    await recordUsage({ ...usage, isError: true, code: "bad_request", status: errorStatus("bad_request") });
    return gatewayError("bad_request", { detail: parsed.error.flatten() });
  }

  const body = parsed.data;
  const tag = appIdToTag(body.model) ?? body.model;
  let requestBody = body as ResponsesCompactionInput;
  let chatBody: Json;
  let contextRetry = false;

  const prepareBody = async (candidate: ResponsesCompactionInput): Promise<ResponsesCompactionInput> => {
    const compacted = compactResponsesRequest(candidate).body;
    const normalized = await normalizeResponsesImages(compacted.input);
    return { ...compacted, input: normalized as ResponsesCompactionInput["input"] };
  };

  try {
    requestBody = await prepareBody(requestBody);
    chatBody = toChatBody(requestBody as z.infer<typeof Body>, tag);
  } catch (error) {
    gate.release();
    const detail = error instanceof ResponseImageError ? error.message : (error as Error)?.message;
    await recordUsage({ ...usage, isError: true, model: body.model, code: "bad_request", status: errorStatus("bad_request"), message: detail });
    return gatewayError("bad_request", detail ? { detail } : undefined);
  }

  const compactAfterContextError = async () => {
    if (contextRetry) return false;
    const retry = compactResponsesRequest(body as ResponsesCompactionInput, { force: true });
    if (!retry.stats.compacted) return false;
    contextRetry = true;
    const normalized = await normalizeResponsesImages(retry.body.input);
    requestBody = { ...retry.body, input: normalized as ResponsesCompactionInput["input"] };
    chatBody = toChatBody(requestBody as z.infer<typeof Body>, tag);
    return true;
  };

  try {
    if (body.stream === true) {
      let upstream = await ollamaChatStream(tag, chatBody);
      if (!upstream.ok || !upstream.body) {
        let errorBody = await upstream.text().catch(() => "");
        const classified = classifyBackendError(upstream.status, errorBody);
        if (classified.key === "context_length_exceeded" && await compactAfterContextError()) {
          upstream = await ollamaChatStream(tag, chatBody);
          if (!upstream.ok || !upstream.body) errorBody = await upstream.text().catch(() => errorBody);
        }
        if (!upstream.ok || !upstream.body) {
          const { key, detail } = classifyBackendError(upstream.status, errorBody);
          gate.release();
          await recordUsage({ ...usage, isError: true, model: body.model, code: key, status: errorStatus(key), message: detail, stream: true });
          return gatewayError(key, detail ? { detail } : undefined);
        }
      }
      void recordUsage({ ...usage, isError: false, latencyMs: Date.now() - started, model: body.model, status: 200, stream: true });
      return new Response(responsesStream(upstream, body.model, gate.release), {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...corsHeaders(req.headers.get("origin")),
        },
      });
    }

    let result: Json;
    try {
      result = (await ollamaChat(tag, chatBody)) as Json;
    } catch (firstError) {
      if (!(firstError instanceof OllamaError) || classifyBackendError(firstError.status, firstError.body).key !== "context_length_exceeded" || !(await compactAfterContextError())) {
        throw firstError;
      }
      result = (await ollamaChat(tag, chatBody)) as Json;
    }
    gate.release();
    await recordUsage({ ...usage, isError: false, latencyMs: Date.now() - started, model: body.model, status: 200 });
    return NextResponse.json(chatResultToResponse(result, body.model), { headers: corsHeaders(req.headers.get("origin")) });
  } catch (error) {
    gate.release();
    const { key, detail } =
      error instanceof ResponseImageError
        ? { key: "bad_request" as const, detail: error.message }
        : error instanceof OllamaError
          ? classifyBackendError(error.status, error.body)
          : { key: isTimeoutError(error) ? ("backend_timeout" as const) : ("backend_error" as const), detail: (error as Error)?.message };
    await recordUsage({ ...usage, isError: true, model: body.model, code: key, status: errorStatus(key), message: detail, stream: body.stream });
    logGatewayError({ path: PATH, apiName: gate.apiName, model: body.model, code: key, status: errorStatus(key), message: detail, stream: body.stream });
    return gatewayError(key, detail ? { detail } : undefined);
  }
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

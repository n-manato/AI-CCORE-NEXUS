// Backend adapter layer.
//
// Real model inference is NOT implemented here. These are clean adapter
// interfaces with a mock implementation so the gateway endpoints work end-to-end
// for development. To integrate real backends (vLLM, faster-whisper, ComfyUI,
// etc.), implement BackendAdapter and swap `activeBackend`.

import { appIdToTag, ollamaHasTag, ollamaChat } from "@/lib/ollama";

export interface ModelInfo {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  category: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
}

export interface ChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }[];
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface SpeechRequest {
  model: string;
  input: string;
  voice?: string;
  format?: string;
}

export interface SpeechResponse {
  contentType: string;
  // Mock returns a tiny base64 payload instead of real audio bytes.
  base64: string;
  durationMs: number;
}

export interface BackendAdapter {
  name: string;
  listModels(): ModelInfo[];
  chatCompletion(req: ChatRequest): Promise<ChatResponse>;
  textToSpeech(req: SpeechRequest): Promise<SpeechResponse>;
}

// Token estimate that never inspects/stores prompt content beyond its length.
function roughTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

const MOCK_MODELS: ModelInfo[] = [
  { id: "qwen3-8b", object: "model", created: 1_700_000_000, owned_by: "local", category: "LLM" },
  { id: "qwen3-14b", object: "model", created: 1_700_000_000, owned_by: "local", category: "LLM" },
  { id: "qwen2.5-coder-14b", object: "model", created: 1_700_000_000, owned_by: "local", category: "LLM" },
  { id: "kokoro-82m", object: "model", created: 1_700_000_000, owned_by: "local", category: "TTS" },
  { id: "faster-whisper-medium", object: "model", created: 1_700_000_000, owned_by: "local", category: "STT" },
];

export const mockBackend: BackendAdapter = {
  name: "mock",
  listModels() {
    return MOCK_MODELS;
  },
  async chatCompletion(req) {
    const promptTokens = req.messages.reduce((n, m) => n + roughTokens(m.content), 0);
    const reply =
      "This is a mock response from the Local AI Gateway. Real model inference " +
      "is not wired up in this environment; the request was accepted and routed " +
      `to model "${req.model}".`;
    const completionTokens = roughTokens(reply);
    return {
      id: `chatcmpl-mock-${promptTokens}-${completionTokens}`,
      object: "chat.completion",
      created: 1_700_000_000,
      model: req.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: reply },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
    };
  },
  async textToSpeech(req) {
    // A minimal valid (silent) WAV header, base64-encoded. No real synthesis.
    const silentWavBase64 =
      "UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=";
    return {
      contentType: "audio/wav",
      base64: silentWavBase64,
      durationMs: Math.min(60_000, roughTokens(req.input) * 60),
    };
  },
};

// Hybrid backend: serve chat via Ollama when the requested model is pulled there,
// otherwise fall back to the mock so unconfigured models still respond.
export const hybridBackend: BackendAdapter = {
  name: "hybrid(ollama+mock)",
  listModels() {
    return mockBackend.listModels();
  },
  async chatCompletion(req) {
    const tag = appIdToTag(req.model) ?? req.model;
    if (await ollamaHasTag(tag)) {
      const res = (await ollamaChat(tag, req as unknown as Record<string, unknown>)) as ChatResponse;
      return res;
    }
    return mockBackend.chatCompletion(req);
  },
  async textToSpeech(req) {
    return mockBackend.textToSpeech(req);
  },
};

export const activeBackend: BackendAdapter = hybridBackend;

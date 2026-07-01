import "server-only";

// Token budget configuration for the context-management system.
//
// The whole point of this subsystem: full history is stored, but only a bounded,
// relevant slice is ever sent to the model. These numbers decide that slice.
//
// Defaults follow the project brief (max 32768 / reserve 4096 / threshold 24000)
// and can be overridden per model via modelBudget().

export interface ContextBudget {
  /** Hard ceiling = the model's loaded num_ctx. Never send more than this. */
  maxContext: number;
  /** Tokens kept free for the model's own output. */
  outputReserve: number;
  /** Compact once the live (un-summarized) message tokens exceed this. */
  compactThreshold: number;
  /** Per-section soft budgets (sum stays under maxContext - outputReserve). */
  sections: {
    system: number; // system prompt + project rules
    memory: number; // long-term user/project memory
    summary: number; // rolling conversation summary
    retrieval: number; // relevant retrieved chunks
    recent: number; // verbatim recent messages
  };
}

const DEFAULT_BUDGET: ContextBudget = {
  maxContext: 32768,
  outputReserve: 4096,
  compactThreshold: 24000,
  sections: {
    system: 2048,
    memory: 1024,
    summary: 3072,
    retrieval: 6144,
    recent: 18432,
  },
};

// Known per-model context windows (the num_ctx Ollama actually serves them at).
// Keep in sync with how the models are loaded; unlisted models use the default.
const MODEL_MAX_CONTEXT: Record<string, number> = {
  "qwen3-coder-next": 32768,
  "qwen3-coder-next:IQ4_XS": 32768,
  "qwen3-coder-30b": 32768,
  "qwen3-coder:30b-a3b-q8_0": 32768,
};

// Order in which sections are trimmed when the assembled context overflows.
// Earlier = sacrificed first. Recent messages and the summary are the last to go.
export const REDUCTION_ORDER = ["retrieval", "recent", "summary", "memory"] as const;
export type ReducibleSection = (typeof REDUCTION_ORDER)[number];

// Returns the budget for a given model, scaling the section budgets to the
// model's real context window so a larger/smaller num_ctx is used proportionally.
export function modelBudget(model?: string): ContextBudget {
  const max = (model && MODEL_MAX_CONTEXT[model]) || DEFAULT_BUDGET.maxContext;
  if (max === DEFAULT_BUDGET.maxContext) return DEFAULT_BUDGET;

  const scale = max / DEFAULT_BUDGET.maxContext;
  const scaled = (n: number) => Math.floor(n * scale);
  return {
    maxContext: max,
    outputReserve: DEFAULT_BUDGET.outputReserve,
    compactThreshold: scaled(DEFAULT_BUDGET.compactThreshold),
    sections: {
      system: scaled(DEFAULT_BUDGET.sections.system),
      memory: scaled(DEFAULT_BUDGET.sections.memory),
      summary: scaled(DEFAULT_BUDGET.sections.summary),
      retrieval: scaled(DEFAULT_BUDGET.sections.retrieval),
      recent: scaled(DEFAULT_BUDGET.sections.recent),
    },
  };
}

// Total tokens available to the prompt (everything except the output reserve).
export function promptBudget(b: ContextBudget): number {
  return Math.max(0, b.maxContext - b.outputReserve);
}

// Default system prompt used when a conversation/caller doesn't supply one.
export const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful AI assistant served by the AICCORE Nexus local gateway. " +
  "Be concise and accurate. If earlier conversation has been summarized, treat " +
  "the provided summary and retrieved context as authoritative project memory.";

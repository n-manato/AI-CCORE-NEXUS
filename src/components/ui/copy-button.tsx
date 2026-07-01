"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

// Copy-to-clipboard button. Can optionally fetch the text lazily (e.g. reveal a
// secret only when the user clicks copy) via the `getText` callback.
export function CopyButton({
  text,
  getText,
  label = "Copy",
  className,
  onCopied,
}: {
  text?: string;
  getText?: () => Promise<string> | string;
  label?: string;
  className?: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const value = getText ? await getText() : (text ?? "");
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context). Fall back silently.
    }
    setCopied(true);
    onCopied?.();
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-ink-dim hover:bg-bg-hover hover:text-ink",
        className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-ok" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

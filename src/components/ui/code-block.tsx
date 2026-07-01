import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/cn";

// Documentation-first, easy-to-copy code block. No animation behind the text.
export function CodeBlock({
  code,
  title,
  className,
}: {
  code: string;
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-bg-base", className)}>
      <div className="flex items-center justify-between border-b border-border bg-bg-raised px-3 py-1.5">
        <span className="font-mono text-xs text-muted">{title ?? "code"}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-ink">
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

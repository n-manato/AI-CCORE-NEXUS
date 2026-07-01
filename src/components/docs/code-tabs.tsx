"use client";

import { useState } from "react";
import { CodeBlock } from "@/components/ui/code-block";
import { cn } from "@/lib/cn";

export interface CodeTab {
  label: string;
  code: string;
}

// Tabbed code viewer (cURL / Python / Node) with copy buttons.
export function CodeTabs({ tabs }: { tabs: CodeTab[] }) {
  const [active, setActive] = useState(0);
  const tab = tabs[active] ?? tabs[0];
  return (
    <div>
      <div className="mb-1.5 flex gap-1">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            onClick={() => setActive(i)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors",
              i === active ? "bg-accent/15 text-accent" : "text-muted hover:bg-bg-hover hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <CodeBlock title={tab.label} code={tab.code} />
    </div>
  );
}

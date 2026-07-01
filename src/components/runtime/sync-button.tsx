"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/client";

// Syncs the app's model labels to the live Ollama model list.
export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await postJson<{
        ollamaReachable: boolean;
        sidecarReachable: boolean;
        onlineApis: string[];
        running: string[];
      }>("/api/runtime/sync");
      setMsg(
        `Synced — Ollama: ${r.ollamaReachable ? "up" : "down"}, Sidecar: ${r.sidecarReachable ? "up" : "down"}, ${r.onlineApis.length} APIs online`,
      );
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {msg && <span className="text-xs text-muted">{msg}</span>}
      <Button variant="outline" size="sm" onClick={sync} disabled={busy}>
        <RefreshCw className={"h-3.5 w-3.5" + (busy ? " animate-spin" : "")} />
        {busy ? "Syncing..." : "Sync from Ollama"}
      </Button>
    </div>
  );
}

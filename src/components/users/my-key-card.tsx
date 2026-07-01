"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { maskKey } from "@/lib/apikey";
import { postJson } from "@/lib/client";

// Self-service API key card: masked by default with reveal + copy.
export function MyKeyCard({
  userId,
  prefix,
  last4,
  status,
}: {
  userId: string;
  prefix: string | null;
  last4: string | null;
  status: string | null;
}) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchKey(): Promise<string> {
    const res = await postJson<{ key: string }>("/api/keys/reveal", { userId });
    return res.key;
  }

  async function toggle() {
    if (revealed) {
      setRevealed(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setRevealed(await fetchKey());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>My API Key</CardTitle>
        <KeyRound className="h-4 w-4 text-accent" />
      </CardHeader>
      <CardContent>
        {!prefix ? (
          <p className="text-sm text-muted">No API key has been issued to your account yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-bg-base px-3 py-2 font-mono text-sm text-ink">
                {revealed ?? maskKey(prefix, last4 ?? "")}
              </code>
              <Button variant="outline" size="sm" onClick={toggle} disabled={busy}>
                {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                {revealed ? "Hide" : busy ? "..." : "Reveal"}
              </Button>
              <CopyButton getText={fetchKey} label="Copy" />
            </div>
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            <p className="mt-2 text-xs text-muted">
              Send this key as{" "}
              <code className="font-mono text-ink-dim">Authorization: Bearer &lt;key&gt;</code>. Keep
              it secret; never put it in a URL. Key status:{" "}
              <span className={status === "active" ? "text-ok" : "text-warn"}>{status}</span>.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { TableWrap, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/client";

// Plain shape of a server.log record (mirrors ServerLogRecord). Defined locally
// so this client component never imports the server-only server-log module.
export interface LogRecord {
  ts: string;
  level: "info" | "error";
  path: string;
  apiName?: string;
  category?: string;
  userId?: string;
  model?: string;
  status?: number;
  code?: string;
  latencyMs?: number;
  message?: string;
  stream?: boolean;
}

type Row = { id: number; rec: LogRecord };

// Live-tails logs/server.log via SSE: seeds from the server-rendered backlog,
// then prepends each new line pushed by /api/admin/server-logs/stream. Capped at
// 500 rows so a long-lived tab never grows unbounded.
export function LogStream({ initial }: { initial: LogRecord[] }) {
  const idRef = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => initial.map((rec) => ({ id: idRef.current++, rec })));
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/admin/server-logs/stream");
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.onmessage = (e) => {
      try {
        const rec = JSON.parse(e.data) as LogRecord;
        setRows((prev) => [{ id: idRef.current++, rec }, ...prev].slice(0, 500));
      } catch {
        /* ignore a malformed line */
      }
    };
    return () => es.close();
  }, []);

  const visible = errorsOnly ? rows.filter((r) => r.rec.level === "error") : rows;
  const errorCount = rows.reduce((n, r) => n + (r.rec.level === "error" ? 1 : 0), 0);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge tone={live ? "ok" : "muted"} dot>
            {live ? "Live" : "Connecting…"}
          </Badge>
          <span className="text-xs text-muted">
            {visible.length} shown · {errorCount} errors
          </span>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-dim">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => setErrorsOnly(e.target.checked)}
            className="accent-accent"
          />
          Errors only
        </label>
      </div>

      <TableWrap>
        <THead>
          <TR>
            <TH>Time</TH>
            <TH>Level</TH>
            <TH>API</TH>
            <TH>Model</TH>
            <TH className="text-right">Status</TH>
            <TH>Code</TH>
            <TH className="text-right">Latency</TH>
            <TH>Message</TH>
          </TR>
        </THead>
        <TBody>
          {visible.length === 0 ? (
            <TR>
              <TD colSpan={8} className="py-10 text-center text-muted">
                No log entries yet. Make a gateway request to see it here.
              </TD>
            </TR>
          ) : (
            visible.map(({ id, rec }) => (
              <TR key={id}>
                <TD className="whitespace-nowrap text-xs text-muted">{formatDateTime(rec.ts)}</TD>
                <TD>
                  <Badge tone={rec.level === "error" ? "danger" : "muted"} dot={false} className="text-[11px]">
                    {rec.level}
                  </Badge>
                </TD>
                <TD className="text-ink-dim">
                  {rec.apiName ?? "-"}
                  {rec.category ? <span className="ml-1 text-xs text-muted">({rec.category})</span> : null}
                </TD>
                <TD className="text-xs text-ink-dim">{rec.model ?? "-"}</TD>
                <TD className="text-right tabular-nums text-xs">
                  <span className={rec.level === "error" ? "text-danger" : "text-muted"}>{rec.status ?? "-"}</span>
                </TD>
                <TD>
                  {rec.code ? (
                    <Badge tone="warn" dot={false} className="font-mono text-[11px]">
                      {rec.code}
                    </Badge>
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </TD>
                <TD className="text-right tabular-nums text-xs text-muted">
                  {rec.latencyMs ? `${rec.latencyMs}ms` : "-"}
                </TD>
                <TD className="max-w-[320px] truncate text-xs text-muted" title={rec.message ?? ""}>
                  {rec.message ?? "-"}
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </TableWrap>
    </>
  );
}

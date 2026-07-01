import { PageHeader } from "@/components/layout/page-header";
import { LogStream } from "@/components/admin/log-stream";
import { readRecentServerLog } from "@/lib/server-log";

export const dynamic = "force-dynamic";
export const metadata = { title: "Server Logs - Local AI Gateway" };

// Live gateway request log. Unlike the dev terminal (lost on restart), every
// request — and every classified model/backend error — is appended to
// logs/server.log; this page renders the recent backlog and tails it live (SSE).
export default async function ServerLogsPage() {
  const initial = await readRecentServerLog(300);

  return (
    <>
      <PageHeader
        title="Server Logs"
        description="Live gateway request log — model and backend errors with their classified code, plus every request. Updates in real time."
      />
      <LogStream initial={initial} />
    </>
  );
}

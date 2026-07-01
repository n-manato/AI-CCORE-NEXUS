// Next.js instrumentation: runs once when the server process starts.
// Starts the background worker (live label sync + job queue processing).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startBackgroundWorker } = await import("@/lib/worker");
  startBackgroundWorker();
}

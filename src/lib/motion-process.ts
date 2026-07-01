import "server-only";
import { motionHealth } from "./motion";

// Node built-ins via eval-require: Next traces this module for BOTH runtimes
// (middleware + instrumentation), but it only ever RUNS in the Node.js runtime
// (instrumentation guards on NEXT_RUNTIME; the admin API routes are Node). eval-
// require keeps child_process/fs out of the Edge bundle (no "module not found"),
// while resolving normally at runtime in Node.
const nodeRequire = eval("require") as NodeRequire;
const { spawn } = nodeRequire("child_process") as typeof import("child_process");
const fs = nodeRequire("fs") as typeof import("fs");
const path = nodeRequire("path") as typeof import("path");

// Lifecycle for the HY-Motion backend PROCESS (motion-service/run.sh). Unlike
// Ollama (one server that loads/unloads models) HY-Motion's model IS its process'
// VRAM, so the UI enable toggle starts/stops the whole process - the analog of
// ollamaSetLoaded. Started detached so it survives Next.js dev hot-reloads; the
// pid is tracked in a file so we never double-spawn.

const DIR = path.join(process.cwd(), "motion-service");
const PIDFILE = path.join(DIR, ".motion.pid");

function readPid(): number {
  try {
    const pid = Number(fs.readFileSync(PIDFILE, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

export function isMotionProcessAlive(): boolean {
  const pid = readPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0); // signal 0 = existence check
    return true;
  } catch {
    return false;
  }
}

// Start motion-service if not already up (idempotent). No-op if a process is
// already running (tracked pid) or the port already answers (started manually).
export async function startMotionService(): Promise<void> {
  if (isMotionProcessAlive()) return;
  if (await motionHealth(1500)) return;
  try {
    fs.mkdirSync(path.join(DIR, "logs"), { recursive: true });
    const out = fs.openSync(path.join(DIR, "logs", "motion.log"), "a");
    // Don't inherit the gateway's PORT (=3000) — motion-service must bind 8801.
    const env = { ...process.env };
    delete env.PORT;
    const child = spawn("bash", ["run.sh"], {
      cwd: DIR,
      detached: true, // own process group -> killable as a unit
      stdio: ["ignore", out, out],
      env,
    });
    child.unref();
    if (child.pid) fs.writeFileSync(PIDFILE, String(child.pid));
  } catch (e) {
    console.error("[motion] start failed:", (e as Error)?.message);
  }
}

// Stop the motion-service process group (frees the GPU). Idempotent.
export function stopMotionService(): void {
  const pid = readPid();
  if (pid) {
    try {
      process.kill(-pid, "SIGTERM"); // kill the whole group (run.sh -> uvicorn)
    } catch {
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    }
  }
  try { fs.unlinkSync(PIDFILE); } catch { /* no pid file */ }
}

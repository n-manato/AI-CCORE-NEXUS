import "server-only";
import { gestureHealth } from "./gesture";

// Node built-ins via eval-require (same trick as motion-process.ts: keep
// child_process/fs out of the Edge bundle; resolves normally in the Node runtime).
const nodeRequire = eval("require") as NodeRequire;
const { spawn } = nodeRequire("child_process") as typeof import("child_process");
const fs = nodeRequire("fs") as typeof import("fs");
const path = nodeRequire("path") as typeof import("path");

// Lifecycle for the GestureLSM backend PROCESS (gesture-service/run.sh). Like
// HY-Motion, the model IS its process' VRAM, so the UI enable toggle starts/stops
// the whole process. Started detached (survives Next hot-reloads); pid tracked in
// a file so we never double-spawn.

const DIR = path.join(process.cwd(), "gesture-service");
const PIDFILE = path.join(DIR, ".gesture.pid");

function readPid(): number {
  try {
    const pid = Number(fs.readFileSync(PIDFILE, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

// Recover processes whose pid file was lost or overwritten.  This can happen
// across deployments, and previously left GestureLSM permanently resident even
// after its runtime config was disabled.
function gesturePids(): number[] {
  const pids = new Set<number>();
  const tracked = readPid();
  if (tracked) pids.add(tracked);
  try {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").replaceAll("\0", " ");
        if (cmdline.includes("gesture_service.py")) pids.add(Number(entry));
      } catch { /* process exited while scanning */ }
    }
  } catch { /* non-Linux runtime: fall back to the pid file */ }
  return [...pids];
}

export function isGestureProcessAlive(): boolean {
  for (const pid of gesturePids()) {
    try {
      process.kill(pid, 0); // signal 0 = existence check
      return true;
    } catch { /* stale pid */ }
  }
  return false;
}

// Start gesture-service if not already up (idempotent): no-op if the tracked pid
// is alive or the port already answers (started manually).
export async function startGestureService(): Promise<void> {
  if (isGestureProcessAlive()) return;
  if (await gestureHealth(1500)) return;
  try {
    fs.mkdirSync(path.join(DIR, "logs"), { recursive: true });
    const out = fs.openSync(path.join(DIR, "logs", "gesture.log"), "a");
    const env = { ...process.env };
    delete env.PORT; // don't inherit the gateway's 3000 — service must bind 8802
    const child = spawn("bash", ["run.sh"], {
      cwd: DIR,
      detached: true, // own process group -> killable as a unit
      stdio: ["ignore", out, out],
      env,
    });
    child.unref();
    if (child.pid) fs.writeFileSync(PIDFILE, String(child.pid));
  } catch (e) {
    console.error("[gesture] start failed:", (e as Error)?.message);
  }
}

// Stop the gesture-service process group (frees GPU0). Idempotent.
export function stopGestureService(): void {
  for (const pid of gesturePids()) {
    try {
      process.kill(-pid, "SIGTERM"); // whole group (run.sh -> python -> uvicorn)
    } catch {
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    }
  }
  try { fs.unlinkSync(PIDFILE); } catch { /* no pid file */ }
}

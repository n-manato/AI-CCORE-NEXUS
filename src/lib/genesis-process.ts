import "server-only";
import { genesisHealth } from "./genesis";

// Lifecycle for the Genesis3D orchestrator PROCESS (Genesis3D/scripts/run.sh).
// Same shape as trellis-process.ts / motion-process.ts: started detached so it
// survives Next hot-reloads, pid tracked in a file so we never double-spawn.
//
// Genesis3D lives OUTSIDE this repo (its own project). GENESIS_DIR overrides the
// default sibling path.

const nodeRequire = eval("require") as NodeRequire;
const { spawn } = nodeRequire("child_process") as typeof import("child_process");
const fs = nodeRequire("fs") as typeof import("fs");
const path = nodeRequire("path") as typeof import("path");

const DIR =
  process.env.GENESIS_DIR ??
  path.resolve(process.cwd(), "..", "Genesis3D");
const PIDFILE = path.join(DIR, ".genesis.pid");

function readPid(): number {
  try {
    const pid = Number(fs.readFileSync(PIDFILE, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return 0;
  }
}

// Recover processes whose pid file was lost (e.g. across deploys), so a disabled
// model can never stay permanently resident.
function genesisPids(): number[] {
  const pids = new Set<number>();
  const tracked = readPid();
  if (tracked) pids.add(tracked);
  try {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").replaceAll("\0", " ");
        if (cmdline.includes("orchestrator.app")) pids.add(Number(entry));
      } catch {
        /* process exited while scanning */
      }
    }
  } catch {
    /* non-Linux runtime: fall back to the pid file */
  }
  return [...pids];
}

export function isGenesisProcessAlive(): boolean {
  for (const pid of genesisPids()) {
    try {
      process.kill(pid, 0); // signal 0 = existence check
      return true;
    } catch {
      /* stale pid */
    }
  }
  return false;
}

// Start Genesis3D if not already up (idempotent): no-op if the tracked pid is
// alive or the port already answers (started manually).
export async function startGenesisService(): Promise<void> {
  if (isGenesisProcessAlive()) return;
  if (await genesisHealth(1500)) return;
  try {
    fs.mkdirSync(path.join(DIR, "logs"), { recursive: true });
    const out = fs.openSync(path.join(DIR, "logs", "orchestrator.log"), "a");
    const env = { ...process.env };
    delete env.PORT; // don't inherit the gateway's 3000 — service must bind 8820
    const child = spawn("bash", ["scripts/run.sh"], {
      cwd: DIR,
      detached: true, // own process group -> killable as a unit
      stdio: ["ignore", out, out],
      env,
    });
    child.unref();
    if (child.pid) fs.writeFileSync(PIDFILE, String(child.pid));
  } catch (e) {
    console.error("[genesis] start failed:", (e as Error)?.message);
  }
}

// Stop the Genesis3D process group. Idempotent.
//
// NOTE: a running job is lost. Genesis3D jobs take ~80s-several minutes, so the
// VRAM scheduler deliberately never selects genesis3d as an eviction victim;
// this is only called from an explicit admin disable.
export function stopGenesisService(): void {
  for (const pid of genesisPids()) {
    try {
      process.kill(-pid, "SIGTERM"); // whole group (run.sh -> python -> uvicorn)
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }
  try {
    fs.unlinkSync(PIDFILE);
  } catch {
    /* no pid file */
  }
}

import "server-only";
import { ttsHealth } from "./tts";

// Node built-ins via eval-require (same trick as gesture-process.ts / trellis-process.ts:
// keep child_process/fs out of the Edge bundle; resolves normally in the Node runtime).
const nodeRequire = eval("require") as NodeRequire;
const { spawn } = nodeRequire("child_process") as typeof import("child_process");
const fs = nodeRequire("fs") as typeof import("fs");
const path = nodeRequire("path") as typeof import("path");
const os = nodeRequire("os") as typeof import("os");

// Lifecycle for the Rem voice stack backing `gpt-sovits`: TWO processes —
// GPT-SoVITS (api_v2.py, :9880) and voice_service/RVC (voice_service.py, :9881).
// Their canonical, idempotent starter is the repo owner's keepalive.sh. Its cron
// entries are disabled so Gateway is the sole lifecycle authority and this stack
// can participate in real On Demand eviction.

const VOICE_DIR = process.env.VOICE_DIR ?? path.join(os.homedir(), "Documents/DEV/AICCORE-Nexus/stack/voice");
const KEEPALIVE = path.join(VOICE_DIR, "keepalive.sh");

// PIDs of the two voice-stack processes (by script name in /proc).
function ttsPids(): number[] {
  const pids = new Set<number>();
  try {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, "utf8").replaceAll("\0", " ");
        if (cmdline.includes("api_v2.py") || cmdline.includes("voice_service.py")) pids.add(Number(entry));
      } catch { /* process exited while scanning */ }
    }
  } catch { /* non-Linux runtime */ }
  return [...pids];
}

export function isTtsProcessAlive(): boolean {
  for (const pid of ttsPids()) {
    try {
      process.kill(pid, 0); // existence check
      return true;
    } catch { /* stale */ }
  }
  return false;
}

// Bring the voice stack up if it isn't answering (idempotent). Reuses keepalive.sh,
// which starts only whatever is down (GPT-SoVITS and/or voice_service). No-op if
// the stack already answers on :9881.
export async function startTtsService(): Promise<void> {
  if (await ttsHealth(1500)) return;
  if (!fs.existsSync(KEEPALIVE)) {
    console.error(`[tts] keepalive not found at ${KEEPALIVE}; cannot start voice stack`);
    return;
  }
  try {
    const child = spawn("bash", [KEEPALIVE], {
      cwd: VOICE_DIR,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
  } catch (e) {
    console.error("[tts] start failed:", (e as Error)?.message);
  }
}

// Stop both voice-stack process groups (frees their GPU1 VRAM).
export function stopTtsService(): void {
  for (const pid of ttsPids()) {
    try {
      process.kill(-pid, "SIGTERM"); // whole group
    } catch {
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    }
  }
}

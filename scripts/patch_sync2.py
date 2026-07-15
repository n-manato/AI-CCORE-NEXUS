"""Add gesturelsm-1 to the sync `running` list (via gestureLoaded) so
observeResidentModels() keeps it resident -> the VRAM lease acquires immediately
(mirrors the MOTION_MODELS running block)."""
p = "src/lib/sync.ts"
s = open(p, encoding="utf-8").read()
if "gestureLoaded" in s:
    print("sync.ts already has running block")
    raise SystemExit(0)

a = "  const gestureCaps = ghealth?.capabilities ?? {};"
assert a in s, "gestureCaps line not found (run patch_sync.py first)"
s = s.replace(a, a + "\n  const gestureLoaded = ghealth?.loaded ?? {};", 1)

b = "  }\n\n  // --- Models with no backend at all -> not installed, stopped (honest) ---"
assert b in s, "anchor before managed not found"
block = (
    "  }\n\n"
    "  for (const appId of Object.keys(GESTURE_MODELS)) {\n"
    '    const isRunning = !!gestureLoaded["gesturelsm"];\n'
    "    installed.push(appId);\n"
    "    if (isRunning) running.push(appId);\n"
    "    await prisma.modelRuntimeState\n"
    '      .update({ where: { modelId: appId }, data: { currentStatus: isRunning ? "Running" : "Stopped", actualDevice: isRunning ? "GPU0" : null } })\n'
    "      .catch(() => {});\n"
    "  }\n\n"
    "  // --- Models with no backend at all -> not installed, stopped (honest) ---"
)
s = s.replace(b, block, 1)
open(p, "w", encoding="utf-8").write(s)
print("patched sync.ts running block (2 edits)")

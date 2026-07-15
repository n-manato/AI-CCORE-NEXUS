"""Make the VRAM scheduler manage gesturelsm-1 as a Nexus-owned process (like
HY-Motion): residency via the pidfile, and loadModel/unloadModel start/stop the
gesture-service. Requires patch_scheduler.py already applied."""
p = "src/lib/vram-scheduler.ts"
s = open(p, encoding="utf-8").read()
if "gesture-process" in s:
    print("scheduler already process-managed")
    raise SystemExit(0)

# 1) import the process lifecycle fns
a = 'import { GESTURE_MODELS, gestureHealth } from "@/lib/gesture";'
assert a in s, "gesture import (patch_scheduler.py) not found"
s = s.replace(a, a + '\nimport { isGestureProcessAlive, startGestureService, stopGestureService } from "@/lib/gesture-process";', 1)

# 2) residency via pidfile (mirror motion) instead of a health probe
b = "    if (await gestureHealth(1000)) for (const id of Object.keys(GESTURE_MODELS)) state.resident.add(id);"
assert b in s, "gesture resident line not found"
s = s.replace(b, "    if (isGestureProcessAlive()) for (const id of Object.keys(GESTURE_MODELS)) state.resident.add(id);", 1)

# 3) unloadModel adapter
c = "  else if (m.modelId in MOTION_MODELS) stopMotionService();"
assert c in s, "motion unload line not found"
s = s.replace(c, c + "\n  else if (m.modelId in GESTURE_MODELS) stopGestureService();", 1)

# 4) loadModel adapter (after the motion block)
d = (
    "  else if (m.modelId in MOTION_MODELS) {\n"
    "    await startMotionService();\n"
    "    const deadline = Date.now() + 60_000;\n"
    "    while (!(await motionHealth(1500))) {\n"
    '      if (Date.now() >= deadline) throw new Error("motion service did not become ready within 60s");\n'
    "      await new Promise((resolve) => setTimeout(resolve, 500));\n"
    "    }\n"
    "  }"
)
assert d in s, "motion loadModel block not found"
g = d + (
    "\n  else if (m.modelId in GESTURE_MODELS) {\n"
    "    await startGestureService();\n"
    "    const gdeadline = Date.now() + 60_000;\n"
    "    while (!(await gestureHealth(1500))) {\n"
    '      if (Date.now() >= gdeadline) throw new Error("gesture service did not become ready within 60s");\n'
    "      await new Promise((resolve) => setTimeout(resolve, 500));\n"
    "    }\n"
    "  }"
)
s = s.replace(d, g, 1)
open(p, "w", encoding="utf-8").write(s)
print("patched vram-scheduler process management (4 edits)")

"""Make the VRAM scheduler treat gesturelsm-1 as an externally-managed, always-
resident model (like HY-Motion via isMotionProcessAlive). Being in actualResident
makes acquireVramLease succeed immediately (no loadModel adapter needed)."""
p = "src/lib/vram-scheduler.ts"
s = open(p, encoding="utf-8").read()
if "GESTURE_MODELS" in s:
    print("scheduler already patched")
    raise SystemExit(0)

a = 'import { MOTION_MODELS, motionHealth } from "@/lib/motion";'
assert a in s, "motion import not found"
s = s.replace(a, a + '\nimport { GESTURE_MODELS, gestureHealth } from "@/lib/gesture";', 1)

b = '    if (isMotionProcessAlive()) for (const id of Object.keys(MOTION_MODELS)) state.resident.add(id);'
assert b in s, "motion resident line not found"
s = s.replace(
    b,
    b + '\n    if (await gestureHealth(1000)) for (const id of Object.keys(GESTURE_MODELS)) state.resident.add(id);',
    1,
)
open(p, "w", encoding="utf-8").write(s)
print("patched vram-scheduler (2 edits)")

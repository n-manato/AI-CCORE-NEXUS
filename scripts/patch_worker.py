"""Make the reconciliation worker start/stop the gesture-service on the enable
toggle + on boot (mirrors the HY-Motion block) — so gesturelsm-1 is a first-class
Nexus-managed model (Always Running -> auto-started = persistence)."""
p = "src/lib/worker.ts"
s = open(p, encoding="utf-8").read()
if "gesture-process" in s:
    print("worker already patched")
    raise SystemExit(0)

a = 'import { startMotionService, stopMotionService, isMotionProcessAlive } from "@/lib/motion-process";'
assert a in s, "motion-process import not found"
s = s.replace(a, a + '\nimport { startGestureService, stopGestureService, isGestureProcessAlive } from "@/lib/gesture-process";', 1)

b = (
    '  const motion = models.find((m) => m.modelId === "hy-motion-1");\n'
    "  if (motion?.runtimeConfig) {\n"
    "    const wantUp = motion.runtimeConfig.enabled && motion.runtimeConfig.startupPolicy === \"Always Running\";\n"
    "    const isUp = isMotionProcessAlive();\n"
    "    if (wantUp && !isUp) {\n"
    "      await startMotionService();\n"
    "    } else if ((!motion.runtimeConfig.enabled || motion.runtimeConfig.startupPolicy === \"Disabled\") && isUp) {\n"
    "      stopMotionService();\n"
    "      noteModelResidency(motion.modelId, false);\n"
    "    }\n"
    "  }"
)
assert b in s, "motion worker block not found"
g = b + (
    "\n\n"
    "  // GestureLSM: same as HY-Motion — a separate process the enable toggle starts/stops.\n"
    '  const gesture = models.find((m) => m.modelId === "gesturelsm-1");\n'
    "  if (gesture?.runtimeConfig) {\n"
    "    const wantUp = gesture.runtimeConfig.enabled && gesture.runtimeConfig.startupPolicy === \"Always Running\";\n"
    "    const isUp = isGestureProcessAlive();\n"
    "    if (wantUp && !isUp) {\n"
    "      await startGestureService();\n"
    "    } else if ((!gesture.runtimeConfig.enabled || gesture.runtimeConfig.startupPolicy === \"Disabled\") && isUp) {\n"
    "      stopGestureService();\n"
    "      noteModelResidency(gesture.modelId, false);\n"
    "    }\n"
    "  }"
)
s = s.replace(b, g, 1)
open(p, "w", encoding="utf-8").write(s)
print("patched worker.ts (gesture lifecycle block)")

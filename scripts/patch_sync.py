"""Wire GestureLSM into sync.ts exactly like HY-Motion so the API stays Online +
the runtime state isn't reset to Stopped by the reconciliation worker."""
p = "src/lib/sync.ts"
s = open(p, encoding="utf-8").read()
if "GESTURE_API" in s:
    print("sync.ts already patched")
    raise SystemExit(0)

edits = [
    ('import { motionHealth, MOTION_MODELS } from "@/lib/motion";',
     'import { motionHealth, MOTION_MODELS } from "@/lib/motion";\n'
     'import { gestureHealth, GESTURE_MODELS } from "@/lib/gesture";'),

    ('const MOTION_API: Record<string, string> = {\n  "Motion Generation": "motion",\n};',
     'const MOTION_API: Record<string, string> = {\n  "Motion Generation": "motion",\n};\n\n'
     '// api_status.apiName -> gesture-service capability key\n'
     'const GESTURE_API: Record<string, string> = {\n  "Gesture Generation": "gesture",\n};'),

    ('  const motionLoaded = mhealth?.loaded ?? {};',
     '  const motionLoaded = mhealth?.loaded ?? {};\n\n'
     '  const ghealth = await gestureHealth();\n'
     '  const gestureCaps = ghealth?.capabilities ?? {};'),

    ('const managed = [...Object.keys(OLLAMA_MAP), ...Object.keys(SIDECAR_MODELS), ...Object.keys(MOTION_MODELS)];',
     'const managed = [...Object.keys(OLLAMA_MAP), ...Object.keys(SIDECAR_MODELS), ...Object.keys(MOTION_MODELS), ...Object.keys(GESTURE_MODELS)];'),

    ('    } else {\n      status = "Not Installed"; // no backend wired yet',
     '    } else if (api.apiName in GESTURE_API) {\n'
     '      const cap = GESTURE_API[api.apiName];\n'
     '      status = gestureCaps[cap] ? "Online" : "Offline";\n'
     '      if (gestureCaps[cap]) backend = "GestureLSM";\n'
     '    } else {\n      status = "Not Installed"; // no backend wired yet'),
]
for old, new in edits:
    assert old in s, "NOT FOUND: " + repr(old[:60])
    s = s.replace(old, new, 1)
open(p, "w", encoding="utf-8").write(s)
print("patched sync.ts (5 edits)")

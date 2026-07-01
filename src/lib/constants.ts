// Central definitions of the string-valued enums used across the app.
// Keeping these here (instead of DB enums) keeps the schema portable to
// PostgreSQL later and gives a single source of truth for UI + validation.

export const ROLES = ["admin", "user"] as const;
export type Role = (typeof ROLES)[number];

export const USER_STATUS = ["active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const KEY_STATUS = ["active", "disabled"] as const;
export type KeyStatus = (typeof KEY_STATUS)[number];

// API access categories shown in Users & API Access and My Access.
export const CATEGORIES = [
  "LLM",
  "TTS",
  "STT",
  "Image",
  "Vision",
  "Video",
  "Motion",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Access (per-user, per-category permission).
export const ACCESS = ["Enabled", "Disabled"] as const;
export type Access = (typeof ACCESS)[number];

// System-wide status of an API.
export const API_STATUS = [
  "Online",
  "Offline",
  "Disabled",
  "Not Installed",
  "Error",
] as const;
export type ApiStatusValue = (typeof API_STATUS)[number];

// GPU status buckets.
export const GPU_STATUS = ["Available", "Busy", "Full", "Offline"] as const;
export type GpuStatusValue = (typeof GPU_STATUS)[number];

// Final result returned to the user by the access decision engine.
export const RESULTS = [
  "Available",
  "Available, but may be slow",
  "Temporarily unavailable",
  "Not allowed",
  "Not available",
  "Very busy, try later",
  "GPU unavailable",
] as const;
export type ResultValue = (typeof RESULTS)[number];

// API operation modes.
export const MODES = ["Real-time", "Sync", "Job"] as const;
export type Mode = (typeof MODES)[number];

// Job lifecycle.
export const JOB_STATUS = [
  "Waiting",
  "Running",
  "Completed",
  "Failed",
  "Canceled",
] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

// Model runtime control.
export const STARTUP_POLICIES = [
  "Always Running",
  "On Demand",
  "Job Queue",
  "Disabled",
] as const;
export type StartupPolicy = (typeof STARTUP_POLICIES)[number];

export const MODEL_SIZE_CLASSES = ["Small", "Medium", "Large", "XLarge"] as const;
export type ModelSizeClass = (typeof MODEL_SIZE_CLASSES)[number];

// Device plan is system-calculated and read-only in the UI.
export const DEVICE_PLANS = [
  "CPU",
  "1GPU",
  "2GPU",
  "Disabled",
  "Not Installed",
] as const;
export type DevicePlan = (typeof DEVICE_PLANS)[number];

// VRAM forecast status.
export const VRAM_STATUS = [
  "Safe",
  "Caution",
  "Warning",
  "Critical",
  "Over Limit",
  "Invalid Combination",
] as const;
export type VramStatus = (typeof VRAM_STATUS)[number];

export const MODEL_RUNTIME_STATE = [
  "Stopped",
  "Loading",
  "Running",
  "Error",
] as const;
export type ModelRuntimeStateValue = (typeof MODEL_RUNTIME_STATE)[number];

// Hardware facts for the shared server: two independent 24GB GPUs.
export const GPU_COUNT = 2;
export const GPU_VRAM_GB = 24;
export const TOTAL_VRAM_GB = GPU_COUNT * GPU_VRAM_GB; // 48

// GPU status thresholds (fraction of a single 24GB GPU).
export const GPU_BUSY_VRAM = 0.6; // >= 60% -> at least Busy
export const GPU_FULL_VRAM = 0.85; // >= 85% -> Full
export const QUEUE_BUSY = 2; // queue 2-4 -> Busy
export const QUEUE_FULL = 5; // queue >= 5 -> Full

// VRAM forecast thresholds (per single 24GB GPU, as a fraction).
export const VRAM_CAUTION = 0.7;
export const VRAM_WARNING = 0.85;
export const VRAM_CRITICAL = 0.95;

// GPU temperature thresholds (Celsius).
export const TEMP_WARNING = 75;
export const TEMP_CRITICAL = 85;

// Maintenance mode states.
export const MAINTENANCE_STATES = ["Off", "Scheduled", "On"] as const;
export type MaintenanceState = (typeof MAINTENANCE_STATES)[number];

// System setting keys.
export const SETTING_KEYS = {
  maintenanceMode: "maintenance_mode", // Off | Scheduled | On
  maintenanceJobPolicy: "maintenance_job_policy", // continue | cancel | pause
  runtimeDefaults: "runtime_defaults", // JSON snapshot for "Reset to Default"
} as const;

// Admin emergency / management actions recorded in the audit log.
export const ADMIN_ACTIONS = [
  "API_KEY_VIEW",
  "API_KEY_COPY",
  "API_KEY_REGENERATE",
  "API_KEY_DISABLE",
  "API_KEY_ENABLE",
  "API_ACCESS_CHANGE",
  "USER_CREATE",
  "USER_UPDATE",
  "USER_DISABLE",
  "USER_ENABLE",
  "API_STOP",
  "API_RESTART",
  "API_DISABLE",
  "API_ENABLE",
  "JOB_CANCEL",
  "QUEUE_CLEAR",
  "SWITCH_MODEL",
  "UNLOAD_MODEL",
  "RESTART_BACKEND",
  "MAINTENANCE_MODE",
  "RUNTIME_APPLY",
  "RUNTIME_RESET",
  "RUNTIME_SYNC",
] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

// The model that governs each backed API (for runtime enforcement: a request to
// the API is checked against THIS model's runtime config - enabled + maxConcurrent).
// Only APIs with a real backend are listed; others are gated by status alone.
export const API_MODEL: Record<string, string> = {
  "LLM Chat": "qwen3-8b",
  "Vision QA": "qwen2.5-vl-7b",
  OCR: "paddleocr",
  "Object Detection": "yolo11s",
  STT: "faster-whisper-medium",
  TTS: "kokoro-82m",
  "Background Removal": "rembg",
  "Motion Generation": "hy-motion-1",
};

// Maps each gateway endpoint to the access category that governs it.
export const ENDPOINT_CATEGORY: Record<string, Category> = {
  "/v1/chat/completions": "LLM",
  "/v1/rag/query": "LLM",
  "/v1/audio/speech": "TTS",
  "/v1/audio/transcriptions": "STT",
  "/v1/audio/enhance": "STT",
  "/v1/audio/voice-conversion": "STT",
  "/v1/vision/chat": "Vision",
  "/v1/vision/ocr": "Vision",
  "/v1/vision/detect": "Vision",
  "/v1/vision/segment": "Vision",
  "/v1/vision/pose": "Vision",
  "/v1/vision/depth": "Vision",
  "/v1/images/generations": "Image",
  "/v1/images/enhance": "Image",
  "/v1/images/remove-background": "Image",
  "/v1/video/understanding/jobs": "Video",
  "/v1/video/lip-sync/jobs": "Video",
  "/v1/motion/generate": "Motion",
  "/v1/robot-motion/commands": "Motion",
};

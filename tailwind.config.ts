import type { Config } from "tailwindcss";

// Dark, futuristic AI infrastructure dashboard theme.
// Colors are exposed both as Tailwind tokens and as CSS variables (see globals.css).
const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#070b14",
          raised: "#0c1220",
          card: "#10182a",
          hover: "#16213a",
        },
        border: {
          DEFAULT: "#1e2c45",
          strong: "#2a3c5c",
        },
        accent: {
          DEFAULT: "#22d3ee", // cyan / electric blue
          soft: "#38bdf8", // soft blue
          dim: "#0e7490",
        },
        ok: "#34d399",
        warn: "#f59e0b",
        danger: "#f43f5e",
        muted: "#7e8aa3",
        ink: {
          DEFAULT: "#e6edf7",
          dim: "#aab6cc",
        },
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.7)",
        glow: "0 0 0 1px rgba(34,211,238,0.25), 0 0 24px -6px rgba(34,211,238,0.35)",
      },
      borderRadius: {
        xl: "0.9rem",
      },
      fontFamily: {
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-glow": {
          "0%,100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;

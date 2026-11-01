import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  safelist: ["shadow-glow-cyan", "shadow-glow-emerald", "shadow-glow-rose"],
  theme: {
    extend: {
      colors: {
        space: {
          abyss: "#010409",
          void: "#020617",
          panel: "#0b1220",
          line: "#12343f",
          mist: "#94a3b8",
        },
        signal: {
          cyan: "#22d3ee",
          emerald: "#34d399",
          rose: "#fb7185",
        },
      },
      boxShadow: {
        "glow-cyan":
          "0 0 12px rgba(34, 211, 238, 0.35), 0 0 32px rgba(34, 211, 238, 0.18)",
        "glow-emerald":
          "0 0 12px rgba(52, 211, 153, 0.35), 0 0 32px rgba(52, 211, 153, 0.18)",
        "glow-rose":
          "0 0 12px rgba(251, 113, 133, 0.35), 0 0 32px rgba(251, 113, 133, 0.18)",
      },
    },
  },
  plugins: [],
};

export default config;

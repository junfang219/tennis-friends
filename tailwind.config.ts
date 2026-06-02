import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // Tailwind's content scanner picks up `[-:/]` from regex character classes
  // in source files (e.g. /^(\d+)\s*[-:/]\s*(\d+)/) and tries to emit it as
  // an arbitrary property, producing invalid CSS (`-: /;`). Block it.
  blocklist: ["[-:/]"],
  theme: {
    extend: {
      colors: {
        "court-green": {
          DEFAULT: "#1B4332",
          light: "#2D6A4F",
          soft: "#40916C",
          pale: "#74C69D",
        },
        "ball-yellow": {
          DEFAULT: "#C9E265",
          glow: "#D4ED6B",
          pale: "#EEF5D3",
        },
        clay: {
          DEFAULT: "#C17A56",
          light: "#E8A87C",
        },
        "net-white": "#FAFDF6",
        surface: {
          DEFAULT: "#F1F5EC",
          warm: "#F7F5F0",
        },
      },
      fontFamily: {
        display: ["Playfair Display", "Georgia", "serif"],
        body: ["DM Sans", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;

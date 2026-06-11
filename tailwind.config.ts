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
        // Club chats — Wimbledon purple. deep = legible text, soft = avatar
        // gradient top, tint/wash = solid unread/read row backgrounds.
        "club-purple": {
          DEFAULT: "#5B3A8C",
          deep: "#4A2E72",
          soft: "#8A66B8",
          tint: "#ECE6F5",
          wash: "#F5F1FA",
        },
        // Circle chats — tennis-ball lime. Same variant roles as club-purple.
        "circle-lime": {
          DEFAULT: "#AEC93A",
          deep: "#5E7A18",
          soft: "#C7DD5E",
          tint: "#EEF4D6",
          wash: "#F6FAE8",
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

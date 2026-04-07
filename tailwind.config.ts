import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
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

import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ["Georgia", "'Times New Roman'", "serif"],
        mono: ["'JetBrains Mono'", "'SF Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;

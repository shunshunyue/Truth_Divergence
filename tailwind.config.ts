import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        void: "#08090b",
        panel: "#111318",
        carbon: "#1b1f26",
        brass: "#d6a247",
        rust: "#c5533d",
        scan: "#6fd5c7",
        paper: "#d8d0bd",
        signal: "#e7f05f",
      },
      fontFamily: {
        display: ["Bahnschrift", "Agency FB", "Arial Narrow", "sans-serif"],
        mono: ["Cascadia Mono", "Consolas", "monospace"],
        body: ["Aptos", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        terminal: "0 0 0 1px rgba(111, 213, 199, 0.18), 0 18px 80px rgba(0, 0, 0, 0.48)",
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Vazirmatn", "Tahoma", "Segoe UI", "Arial", "sans-serif"],
        mono: ["Consolas", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;

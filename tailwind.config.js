/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#241417",
        paper: "#f6f1e6",
        parchment: "#fbf8f1",
        midnight: "#fffdfc",
        navy: "#7a6b6d",
        // Maroon now spans a small tonal range instead of one flat red:
        // -ink for headings/crest linework, base for interactive/brand
        // moments, -deep for pressed/emphasis states.
        maroon: {
          DEFAULT: "#a3123f",
          ink: "#5c1026",
          deep: "#7a0f30",
          50: "#fbeaf0",
        },
        brass: "#a9772c",
        success: "#1a7a4c",
        line: "rgba(36,20,23,0.10)",
      },
      fontFamily: {
        // Slab serif for headings/eyebrows -- reads like a certificate or
        // school register heading, not another SaaS dashboard. Inter stays
        // for body copy and anything tabular (marks, dates, counts).
        display: ["Bitter", "Georgia", "serif"],
        body: ["Inter", "system-ui", "-apple-system", "\"Segoe UI\"", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};

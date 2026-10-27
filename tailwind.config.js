/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./frontend/index.html", "./frontend/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Manrope", "Inter", "ui-sans-serif", "sans-serif"],
      },
      boxShadow: {
        glow: "0 12px 40px rgba(79, 70, 229, .25)",
      },
      animation: {
        "fade-up": "fadeUp .35s ease-out both",
        "soft-pulse": "softPulse 2s ease-in-out infinite",
      },
      keyframes: {
        fadeUp: { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        softPulse: { "0%, 100%": { opacity: ".55" }, "50%": { opacity: "1" } },
      },
    },
  },
  plugins: [],
};

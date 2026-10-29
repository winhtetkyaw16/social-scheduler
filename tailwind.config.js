/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./frontend/index.html", "./frontend/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      // SocialCastly design tokens (see frontend/src/theme/tokens.css)
      colors: {
        // Slate dark end tuned to the SocialCastly navy dark theme
        slate: { 50: "#F8FAFC", 100: "#F1F5F9", 200: "#E2E8F0", 300: "#CBD5E1", 400: "#94A3B8", 500: "#64748B", 600: "#475569", 700: "#334366", 800: "#1A2540", 900: "#111A2E", 950: "#0B1120" },
        sc: {
          bg: "var(--bg)", surface: "var(--surface)", "surface-2": "var(--surface-2)", "surface-3": "var(--surface-3)",
          border: "var(--border)", "border-strong": "var(--border-strong)", text: "var(--text)", "text-2": "var(--text-2)", "text-3": "var(--text-3)",
          primary: "var(--primary)", "primary-hover": "var(--primary-hover)", "primary-2": "var(--primary-2)", "primary-soft": "var(--primary-soft)", "primary-soft-text": "var(--primary-soft-text)",
          success: "var(--success)", "success-soft": "var(--success-soft)", warning: "var(--warning)", "warning-soft": "var(--warning-soft)", error: "var(--error)", "error-soft": "var(--error-soft)", info: "var(--info)", "info-soft": "var(--info-soft)",
          x: "var(--ch-x)", linkedin: "var(--ch-linkedin)", instagram: "var(--ch-instagram)", facebook: "var(--ch-facebook)", tiktok: "var(--ch-tiktok)", youtube: "var(--ch-youtube)", pinterest: "var(--ch-pinterest)",
        },
      },
      borderRadius: { "sc-sm": "6px", "sc-md": "10px", "sc-lg": "14px", "sc-xl": "20px" },
      spacing: { sidebar: "248px", topbar: "64px" },
      boxShadow: {
        glow: "0 12px 40px rgba(79, 70, 229, .25)",
        "sc-sm": "var(--shadow-sm)", "sc-md": "var(--shadow-md)", "sc-lg": "var(--shadow-lg)",
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

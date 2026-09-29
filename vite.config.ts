import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset paths — needed so the built app loads correctly inside
  // Capacitor's native WebView (served from a local origin, not site root).
  // Harmless for the normal Vercel-hosted site too.
  base: "./",
  plugins: [react()],
});

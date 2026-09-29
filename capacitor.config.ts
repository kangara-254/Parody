import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kariobangisouth.examportal',
  appName: 'KSS Exam Portal',
  webDir: 'dist',
  android: {
    // Serve over https:// inside the WebView (not the default capacitor://)
    // so cookie/storage behaviour matches the real Vercel-hosted site as
    // closely as possible for Supabase auth.
    allowMixedContent: false,
  },
};

export default config;

import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { legacyChromiumColorsPlugin } from './vite-plugin-legacy-chromium-colors'


/**
 * Writes dist/version.json ({ "version": "<build id>" }). Open tabs compare it with the version they were
 * built with to notice a new deployment (an SPA never reloads by itself, not even on logout / login).
 */
function appVersionFilePlugin(version: string): Plugin {
  return {
    name: 'core-app-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Environment bridge (build-time only): Vite exposes only VITE_*
  // variables to browser code, while Vercel's Supabase integration
  // provisions SUPABASE_URL / SUPABASE_ANON_KEY without the prefix.
  // Map exactly those two public values onto the names the app reads.
  // The anon key is safe to expose (protected by RLS). Never add the
  // service-role key or any other SUPABASE_* variable here.
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || ''
  // Public Telegram bot username (not a secret), accepted with or without the VITE_ prefix.
  const telegramBotUsername = (env.VITE_TELEGRAM_BOT_USERNAME || env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '')
  // Build id: the deployed commit on Vercel, otherwise the build time (unique per build).
  const appVersion =
    env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_DEPLOYMENT_ID || `build-${Date.now()}`

  return {
    // Chrome 109 = last Google Chrome / Chromium Edge on Windows 7.
    // Keep modern syntax elsewhere; Vite downlevels only what this target needs.
    build: {
      target: 'chrome109',
      cssTarget: 'chrome109',
    },
    plugins: [
      react(),
      tailwindcss(),
      legacyChromiumColorsPlugin(),
      appVersionFilePlugin(appVersion),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
      'import.meta.env.VITE_TELEGRAM_BOT_USERNAME': JSON.stringify(telegramBotUsername),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    },
  }
})

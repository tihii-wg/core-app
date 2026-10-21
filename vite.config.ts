import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'


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

  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey),
    },
  }
})

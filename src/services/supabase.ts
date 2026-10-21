import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Core App configuration error: the Supabase environment variables are missing. " +
      "Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Vercel → Settings → Environment Variables, " +
      "then redeploy) — or provide SUPABASE_URL and SUPABASE_ANON_KEY, which the build maps automatically. " +
      "Locally, copy .env.example to .env. Never use the Supabase service-role key in the frontend.",
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;

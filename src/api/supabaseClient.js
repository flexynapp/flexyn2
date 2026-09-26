// src/api/supabaseClient.js
// Single Supabase client instance for the entire app.
// Import this — never instantiate createClient elsewhere.
import { createClient } from '@supabase/supabase-js';
import { isNative } from '@/lib/native';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnon) {
  console.error(
    '[Supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.\n' +
    'Add them to .env (local) and to Netlify environment variables (production).'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnon, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Native app only (iOS / Android via Capacitor): PKCE, and no URL
    // sniffing. OAuth and magic links come back on the app.flexyn:// deep
    // link and src/lib/nativeAuth.js trades the code itself; the web view's
    // own URL never carries one. The web is untouched — it stays on the
    // implicit flow, because PKCE keeps the code verifier in the browser
    // that ASKED for the link, and a magic link opened in a different
    // browser (desktop request, phone mail app) would then fail to sign in.
    ...(isNative() ? { flowType: 'pkce', detectSessionInUrl: false } : {}),
  },
});

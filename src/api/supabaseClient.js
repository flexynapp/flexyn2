// src/api/supabaseClient.js
// Single Supabase client instance for the entire app.
// Import this — never instantiate createClient elsewhere.
import { createClient } from '@supabase/supabase-js';

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
    // Implicit flow — token arrives in the URL hash (#access_token=…)
    // and can be processed by any browser context regardless of where
    // the magic link was originally requested. PKCE (the @supabase/
    // supabase-js v2 default) requires a code-verifier stored in
    // localStorage on the device that requested the link; iOS PWAs
    // and Mail-app handoffs commonly open the link in a fresh
    // Safari context where the verifier doesn't exist, so the code
    // exchange silently fails and the user lands back on sign-in
    // forever ("clicks email → bounces to sign-in" loop).
    // Implicit isn't subject to that hand-off failure mode.
    flowType: 'implicit',
  },
});

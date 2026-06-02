// src/lib/data/customQuotes.js
//
// User-authored quotes (mig 153) that cycle into the Dashboard quote
// rotation. RLS scopes every row to its owner; the 20-cap is enforced here
// (and in the UI) since quotes carry no abuse weight.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';

export const MAX_CUSTOM_QUOTES = 20;

/** List the caller's custom quotes, oldest first. */
export async function listMyQuotes() {
  // safeSelect strips columns + retries on 42703 / PGRST204 so a
  // partial-deploy host that hasn't applied migration 153 yet
  // doesn't crash the dashboard quote rotation.
  const { data, error } = await safeSelect({
    columns: ['id', 'text', 'author'],
    build: (cols) => supabase
      .from('custom_quotes')
      .select(cols)
      .order('created_at', { ascending: true }),
  });
  if (error) return [];
  return data || [];
}

/** Add a custom quote.
 *  Throws 'limit' if the user already has the max (mig 154 trigger is the
 *  authoritative gate; this client check is just a fast pre-flight).
 *  Throws 'profanity' if the server-side profanity trigger rejects the
 *  text or author. Throws Error otherwise.
 */
export async function addQuote(text, author = null) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('empty');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('unauthenticated');
  const existing = await listMyQuotes();
  if (existing.length >= MAX_CUSTOM_QUOTES) throw new Error('limit');
  const cleanAuthor = (author || '').trim().slice(0, 80) || null;
  const { data, error } = await supabase
    .from('custom_quotes')
    .insert({ user_id: user.id, text: trimmed.slice(0, 280), author: cleanAuthor })
    .select('id, text, author')
    .single();
  if (error) {
    // Mig 154 raises 23514 with one of two distinguishable HINTs.
    const msg = `${error.message || ''} ${error.hint || ''}`;
    if (/custom_quotes_limit/i.test(msg))      throw new Error('limit');
    if (/custom_quote_profanity/i.test(msg))   throw new Error('profanity');
    throw error;
  }
  return data;
}

/** Delete one of the caller's custom quotes. */
export async function removeQuote(id) {
  if (!id) return;
  const { error } = await supabase.from('custom_quotes').delete().eq('id', id);
  if (error) throw error;
}

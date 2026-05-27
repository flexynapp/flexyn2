// src/lib/data/customQuotes.js
//
// User-authored quotes (mig 153) that cycle into the Dashboard quote
// rotation. RLS scopes every row to its owner; the 20-cap is enforced here
// (and in the UI) since quotes carry no abuse weight.

import { supabase } from '@/api/supabaseClient';

export const MAX_CUSTOM_QUOTES = 20;

/** List the caller's custom quotes, oldest first. */
export async function listMyQuotes() {
  const { data, error } = await supabase
    .from('custom_quotes')
    .select('id, text, author')
    .order('created_at', { ascending: true });
  if (error) return [];
  return data || [];
}

/** Add a custom quote. Throws 'limit' if the user already has the max. */
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
  if (error) throw error;
  return data;
}

/** Delete one of the caller's custom quotes. */
export async function removeQuote(id) {
  if (!id) return;
  const { error } = await supabase.from('custom_quotes').delete().eq('id', id);
  if (error) throw error;
}

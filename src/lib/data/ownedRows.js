// src/lib/data/ownedRows.js
//
// Plain reads and writes for a table whose rows belong to one person.
//
// This replaces the Base44-shaped `db.entities.X` client in src/api/db.js
// one table at a time. The statements are the same ones that client sent,
// and each data module's tests pin them, so a module can move here with no
// change in what reaches the database. What it deliberately does NOT carry
// over: analytics (the screens that save send their own events) and
// duplicate-save handling (workouts.create owns it; no other table has an
// idempotency key).

import { supabase } from '@/api/supabaseClient';
import { accountEmail } from '@/lib/guestIdentity';

/* Columns that scope a read to one person (see filter() below). */
const OWNER_KEYS = ['user_id', 'created_by'];

/** "-created_date" → { column: 'created_date', ascending: false } */
function parseSort(sort) {
  if (!sort) return null;
  const desc = sort.startsWith('-');
  return { column: desc ? sort.slice(1) : sort, ascending: !desc };
}

/**
 * `columns` is the select list every read and every returned row uses. It
 * stays '*' unless the table grants SELECT column by column (other people's
 * emails are not readable there), where '*' is refused with 42501.
 */
export function ownedRows(table, { columns = '*' } = {}) {
  // What a write hands back. '*' keeps the bare .select() these statements
  // have always sent.
  const returning = (q) => (columns === '*' ? q.select() : q.select(columns));
  return {
    /** Rows matching a plain equality map. An array value becomes IN. */
    async filter(conditions = {}, sort, limit = 1000) {
      // An owner key that arrives empty means "no user yet", never "anyone".
      // The loop below skips nullish conditions, so without this a query for
      // the signed-in user's rows would run unfiltered while auth loads and
      // return every row the table's policies let the caller read.
      for (const key of OWNER_KEYS) {
        if (key in conditions && (conditions[key] === undefined || conditions[key] === null || conditions[key] === '')) {
          return [];
        }
      }
      let q = supabase.from(table).select(columns);
      Object.entries(conditions).forEach(([k, v]) => {
        if (v === undefined || v === null) return;
        q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
      });
      const s = parseSort(sort);
      if (s) q = q.order(s.column, { ascending: s.ascending });
      const { data, error } = await q.limit(limit);
      if (error) throw error;
      return data ?? [];
    },

    /** One row by id, or null. */
    async get(id) {
      const { data, error } = await supabase.from(table).select(columns).eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    },

    /**
     * Insert and return the new row. `user_id` and `created_by` are always
     * the signed-in user's, whatever the caller passed: letting a caller
     * name another owner was a privacy hole on any table without a
     * column-level WITH CHECK (audit 17 #T1). A guest has no email, so
     * created_by gets the same placeholder handle_new_user writes to
     * user_profiles.email (mig 172), or NOT NULL columns would refuse
     * every guest write.
     */
    async create(row) {
      const { data: { session } } = await supabase.auth.getSession()
        .catch(() => ({ data: { session: null } }));
      const authUser = session?.user ?? null;
      const email = accountEmail(authUser);
      const enriched = {
        ...row,
        ...(email        ? { created_by: email }       : {}),
        ...(authUser?.id ? { user_id:    authUser.id } : {}),
      };
      const { data, error } = await returning(supabase.from(table).insert(enriched)).single();
      if (error) throw error;
      return data;
    },

    /** Patch one row by id and return it. */
    async update(id, patch) {
      const { data, error } = await returning(supabase.from(table).update({ ...patch }).eq('id', id)).single();
      if (error) throw error;
      return data;
    },

    /** Delete one row by id. */
    async remove(id) {
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
      return true;
    },
  };
}

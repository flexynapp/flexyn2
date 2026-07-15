// src/lib/hubPostsRealtime.js
//
// Single shared Realtime subscription for hub_posts INSERTs.
//
// HubFeed (the "X new posts" pill) and FollowerActivityBanner each used
// to open their OWN unfiltered postgres_changes channel on hub_posts —
// two subscriptions per connected client, so every post insert was
// broadcast to every client twice. Realtime fan-out cost is
// (subscriptions × inserts), so halving subscriptions halves the
// hottest table's realtime load. This module owns ONE channel and
// multiplexes rows to however many in-app listeners are mounted.
//
// The channel exists only while at least one listener is registered —
// refcounted via the listener set, so clients outside the Hub hold no
// hub_posts subscription at all. Listener callbacks keep their own
// filtering (privacy / muted / followed), same as before.

import { supabase } from '@/api/supabaseClient';

let channel = null;
const listeners = new Set();

function ensureChannel() {
  if (channel) return;
  // Unique per-creation channel name — same defensive pattern the two
  // consumers used individually (avoids "cannot add postgres_changes
  // callbacks after subscribe()" on React 18 StrictMode double-mount,
  // where teardown and re-create race).
  const name = `hub_posts_inserts_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  channel = supabase
    .channel(name)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hub_posts' }, (payload) => {
      const row = payload?.new;
      if (!row) return;
      // Snapshot so a listener unsubscribing mid-dispatch can't skip others.
      for (const cb of [...listeners]) {
        try { cb(row); } catch (err) {
          console.warn('[hubPostsRealtime] listener threw:', err);
        }
      }
    })
    .subscribe();
}

/**
 * Register a callback for new hub_posts rows. Returns an unsubscribe
 * function; the underlying channel is torn down when the last listener
 * unsubscribes.
 */
export function onHubPostInsert(cb) {
  listeners.add(cb);
  ensureChannel();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && channel) {
      supabase.removeChannel(channel).catch(() => {});
      channel = null;
    }
  };
}

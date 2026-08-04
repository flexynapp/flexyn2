// src/components/hub/GifPicker.jsx
//
// Tenor-backed GIF picker drawer. Search input + 3-col grid of results.
// Picking one fires `onPick({ url, preview, alt })` so the parent can
// send a message with attachment_url + message_type='gif'.
//
// Requires VITE_TENOR_API_KEY at build time. Without the key the
// picker renders a clear "set the env var" message so the deploy
// gap is obvious rather than failing silently.

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Loader2, Search } from 'lucide-react';

const TENOR_KEY = import.meta.env.VITE_TENOR_API_KEY || '';

// True only when a Tenor key is configured at build time. Callers gate the
// GIF entry point on this so users never see the dev-facing "set the env
// var" state — without a key the whole feature is hidden, not broken.
export const GIF_ENABLED = !!TENOR_KEY;
const TRENDING_URL = `https://tenor.googleapis.com/v2/featured?key=${TENOR_KEY}&limit=24&media_filter=gif,tinygif`;
const searchUrl = (q) =>
  `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&limit=24&media_filter=gif,tinygif`;

export default function GifPicker({ open, onPick, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    if (!TENOR_KEY) { setError('missing_key'); return undefined; }
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(query.trim() ? searchUrl(query.trim()) : TRENDING_URL);
        const json = await res.json();
        const items = (json?.results || []).map(r => {
          const media = r.media_formats || {};
          return {
            id:      r.id,
            url:     media.gif?.url || media.tinygif?.url,
            preview: media.tinygif?.url || media.gif?.url,
            alt:     r.content_description || 'GIF',
          };
        }).filter(g => g.url);
        setResults(items);
      } catch {
        setError('fetch_failed');
      }
      setLoading(false);
    }, query.trim() ? 250 : 0);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [open, query]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      className="absolute bottom-0 start-0 end-0 z-30 bg-card border-t border-border rounded-t-2xl shadow-lg"
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">GIFs</span>
        <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary text-muted-foreground flex items-center justify-center" aria-label="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-4 mb-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/40 border border-border">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Tenor…"
            className="flex-1 bg-transparent text-sm outline-none placeholder-muted-foreground/60"
          />
        </div>
      </div>
      {error === 'missing_key' ? (
        <div className="px-4 pb-6 text-center">
          <p className="text-sm font-bold">GIF search unavailable</p>
          <p className="text-xs text-muted-foreground mt-1">
            Set VITE_TENOR_API_KEY in the build env to enable Tenor.
          </p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="px-4 pb-6 text-center">
          <p className="text-sm font-bold">Couldn't load GIFs</p>
          <p className="text-xs text-muted-foreground mt-1">Try again in a moment.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 px-4 pb-4 max-h-64 overflow-y-auto">
          {results.map(g => (
            <button
              key={g.id}
              onClick={() => { onPick(g); onClose?.(); }}
              className="aspect-square rounded-lg overflow-hidden bg-secondary/30 hover:opacity-90"
              aria-label={`Send ${g.alt}`}
            >
              <img src={g.preview} alt={g.alt} className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <p className="text-micro text-muted-foreground text-center pb-1">Powered by Tenor</p>
    </motion.div>
  );
}

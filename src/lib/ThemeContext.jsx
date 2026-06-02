import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { db } from '@/api/db';
import { LOOT_THEMES, getLootThemeById } from '@/lib/lootThemes';

export const THEMES = [
  {
    id: 'orange-slate',
    name: 'Iron Orange',
    description: 'Default · Orange & Slate',
    unlockLevel: 1,
    preview: ['#e8711a', '#2d3748'],
    vars: {
      '--primary': '26 90% 50%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '210 18% 30%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '26 90% 50%',
      '--sidebar-primary': '26 90% 50%',
      '--sidebar-ring': '26 90% 50%',
    },
  },
  {
    id: 'electric-blue',
    name: 'Electric Blue',
    description: 'Bold & energetic',
    unlockLevel: 10,
    preview: ['#2563eb', '#1e3a5f'],
    vars: {
      '--primary': '221 83% 53%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '214 60% 25%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '221 83% 53%',
      '--sidebar-primary': '221 83% 53%',
      '--sidebar-ring': '221 83% 53%',
    },
  },
  {
    id: 'emerald',
    name: 'Emerald',
    description: 'Fresh & focused',
    unlockLevel: 15,
    preview: ['#10b981', '#064e3b'],
    vars: {
      '--primary': '160 84% 39%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '158 60% 20%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '160 84% 39%',
      '--sidebar-primary': '160 84% 39%',
      '--sidebar-ring': '160 84% 39%',
    },
  },
  {
    id: 'crimson',
    name: 'Crimson',
    description: 'Intense & powerful',
    unlockLevel: 20,
    preview: ['#dc2626', '#450a0a'],
    vars: {
      '--primary': '0 72% 51%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '0 50% 20%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '0 72% 51%',
      '--sidebar-primary': '0 72% 51%',
      '--sidebar-ring': '0 72% 51%',
    },
  },
  {
    id: 'violet',
    name: 'Violet',
    description: 'Sleek & modern',
    unlockLevel: 25,
    preview: ['#7c3aed', '#2e1065'],
    vars: {
      '--primary': '263 70% 50%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '262 50% 22%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '263 70% 50%',
      '--sidebar-primary': '263 70% 50%',
      '--sidebar-ring': '263 70% 50%',
    },
  },
  {
    id: 'gold',
    name: 'Gold',
    description: 'Champion vibes',
    unlockLevel: 30,
    preview: ['#d97706', '#78350f'],
    vars: {
      '--primary': '38 92% 50%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '32 60% 25%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '38 92% 50%',
      '--sidebar-primary': '38 92% 50%',
      '--sidebar-ring': '38 92% 50%',
    },
  },
  {
    id: 'neon',
    name: 'Neon',
    description: 'Electrifying & vivid',
    unlockLevel: 35,
    preview: ['#22c55e', '#052e16'],
    vars: {
      '--primary': '142 76% 45%',
      '--primary-foreground': '0 0% 0%',
      '--accent': '142 60% 18%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '142 76% 45%',
      '--sidebar-primary': '142 76% 45%',
      '--sidebar-ring': '142 76% 45%',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Dark & mysterious',
    unlockLevel: 40,
    preview: ['#4f7cac', '#0d1b2a'],
    vars: {
      '--primary': '210 55% 49%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '210 45% 18%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '210 55% 49%',
      '--sidebar-primary': '210 55% 49%',
      '--sidebar-ring': '210 55% 49%',
    },
  },
  {
    id: 'plasma',
    name: 'Plasma',
    description: 'Raw energy unleashed',
    unlockLevel: 45,
    preview: ['#e91e8c', '#2d0020'],
    vars: {
      '--primary': '329 81% 52%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '329 55% 20%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '329 81% 52%',
      '--sidebar-primary': '329 81% 52%',
      '--sidebar-ring': '329 81% 52%',
    },
  },
  {
    id: 'arctic',
    name: 'Arctic',
    description: 'Pure & crystalline',
    unlockLevel: 50,
    preview: ['#06b6d4', '#082f49'],
    vars: {
      '--primary': '192 91% 42%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '192 60% 18%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '192 91% 42%',
      '--sidebar-primary': '192 91% 42%',
      '--sidebar-ring': '192 91% 42%',
    },
  },
  {
    id: 'brushed-steel',
    name: 'Brushed Steel',
    description: 'Premium metallic finish · Admin',
    unlockLevel: 1,
    adminOnly: true,
    animation: 'steel_usa',
    preview: ['#94a3b8', '#1e293b'],
    vars: {
      '--primary': '215 20% 55%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '215 22% 22%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '215 20% 55%',
      '--sidebar-primary': '215 20% 55%',
      '--sidebar-ring': '215 20% 55%',
    },
  },
];

const ThemeContext = createContext(null);

// Apply theme vars + track which keys we set so a future theme that
// omits a key clears it cleanly instead of inheriting the previous
// theme's value. The previous-keys set is owned by the Provider via
// a ref — moving it out of module scope means a multi-Provider test
// harness can't have one instance stomp another's tracked keys.
function applyVars(vars, prevKeysRef) {
  if (!vars) return;
  const root = document.documentElement;
  const newKeys = new Set(Object.keys(vars));
  // Clear any keys we set on a prior theme that the new one doesn't define.
  for (const oldKey of prevKeysRef.current) {
    if (!newKeys.has(oldKey)) root.style.removeProperty(oldKey);
  }
  // Apply the new theme's vars.
  for (const [k, v] of Object.entries(vars)) {
    root.style.setProperty(k, v);
  }
  prevKeysRef.current = newKeys;
}

export function ThemeProvider({ children }) {
  // Per-Provider set of previously-applied CSS custom-property keys.
  const prevKeysRef = useRef(new Set());
  const [themeId, setThemeIdState] = useState(() => {
    try { return localStorage.getItem('fn-theme') || 'orange-slate'; } catch { return 'orange-slate'; }
  });

  // Loot theme id (null = no loot theme active, a base level-up theme is active instead)
  const [lootThemeId, setLootThemeIdState] = useState(() => {
    try { return localStorage.getItem('fn-loot-theme') || null; } catch { return null; }
  });

  const [darkMode, setDarkModeState] = useState(() => {
    try {
      const saved = localStorage.getItem('fn-dark-mode');
      if (saved !== null) return saved === 'true';
    } catch {}
    return false;
  });

  // Derive the active animation id from the current loot theme (null if none).
  // If a base theme has an animation (e.g. brushed-steel), use that as fallback.
  const lootTheme = lootThemeId ? getLootThemeById(lootThemeId) : null;
  const baseThemeAnim = !lootThemeId ? (THEMES.find(t => t.id === themeId)?.animation ?? null) : null;
  const activeAnimation = lootTheme?.animation ?? baseThemeAnim ?? null;

  // Hydrate from server user on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await db.auth.me();
        if (cancelled) return;
        if (me?.preferred_theme && THEMES.some(t => t.id === me.preferred_theme) && me.preferred_theme !== themeId) {
          setThemeIdState(me.preferred_theme);
          try { localStorage.setItem('fn-theme', me.preferred_theme); } catch {}
        }
        if (typeof me?.dark_mode === 'boolean' && me.dark_mode !== darkMode) {
          setDarkModeState(me.dark_mode);
          try { localStorage.setItem('fn-dark-mode', String(me.dark_mode)); } catch {}
        }
        // Restore loot theme from server if stored there
        if (me?.loot_theme_id) {
          setLootThemeIdState(me.loot_theme_id);
          try { localStorage.setItem('fn-loot-theme', me.loot_theme_id); } catch {}
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  // Apply theme vars — loot theme overrides base theme when active
  useEffect(() => {
    if (lootTheme) {
      applyVars(lootTheme.vars, prevKeysRef);
    } else {
      const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
      applyVars(theme.vars, prevKeysRef);
    }
    // Set [data-theme-tier] on <html> so CSS can target animated/legendary
    // themes (e.g. card accent stripe defined in src/index.css). The tier
    // string mirrors the theme's animation name where present.
    try {
      const root = document.documentElement;
      if (lootTheme?.animated) {
        root.setAttribute('data-theme-tier',
          lootTheme.rarity === 'legendary' ? 'legendary' : 'animated');
      } else {
        root.removeAttribute('data-theme-tier');
      }
    } catch { /* ignore */ }
    try { localStorage.setItem('fn-theme', themeId); } catch {}
  }, [themeId, lootThemeId, lootTheme]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try { localStorage.setItem('fn-dark-mode', String(darkMode)); } catch {}
  }, [darkMode]);

  const setThemeId = useCallback((id) => {
    // Switching a level-up theme clears the loot theme
    setThemeIdState(id);
    setLootThemeIdState(null);
    try { localStorage.removeItem('fn-loot-theme'); } catch {}
    try { db.auth.updateMe({ preferred_theme: id, loot_theme_id: null }).catch(() => {}); } catch {}
    try { window.dispatchEvent(new CustomEvent('flexyn:theme-changed')); } catch {}
  }, []);

  const setLootThemeId = useCallback((id) => {
    setLootThemeIdState(id);
    try {
      if (id) {
        localStorage.setItem('fn-loot-theme', id);
        db.auth.updateMe({ loot_theme_id: id }).catch(() => {});
      } else {
        localStorage.removeItem('fn-loot-theme');
        db.auth.updateMe({ loot_theme_id: null }).catch(() => {});
      }
      // Notify any cross-user views (HubProfile of others, hub authors list)
      // that this user's theme changed. Other-tab viewers will refetch on
      // their next staleTime / window-focus.
      window.dispatchEvent(new CustomEvent('flexyn:theme-changed'));
    } catch {}
  }, []);

  const setDarkMode = useCallback((val) => {
    setDarkModeState(val);
    try { db.auth.updateMe({ dark_mode: val }).catch(() => {}); } catch {}
  }, []);

  // Memoize the context value so every consumer (useTheme) doesn't re-render
  // on every parent re-render. Without this, the object literal in `value={{...}}`
  // gets a new reference every render → all useContext(ThemeContext) call sites
  // re-render. Hundreds of components touch this in Flexyn; the difference is
  // measurable in CPU profiles on slower phones.
  const value = useMemo(() => ({
    themeId,
    setThemeId,
    lootThemeId,
    setLootThemeId,
    activeAnimation,
    darkMode,
    setDarkMode,
  }), [themeId, setThemeId, lootThemeId, setLootThemeId, activeAnimation, darkMode, setDarkMode]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

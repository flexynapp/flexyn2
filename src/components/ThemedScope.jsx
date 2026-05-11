// src/components/ThemedScope.jsx
import { getThemeStyle, isAnimatedTheme } from '@/lib/themeScope';

/**
 * Wraps children in a div that overrides CSS variables for primary/accent/ring
 * to match the given themeId. Tailwind classes like `bg-primary`, `text-primary`
 * resolve through these vars and will pick up the scoped values.
 *
 * Dark mode is intentionally NOT scoped — the viewer keeps their own light/dark
 * preference. Only the theme accent palette changes.
 *
 * Loot themes (capsule drops, including animated/legendary) take precedence
 * over the level-up base theme when both ids are passed — same order as the
 * global ThemeContext apply.
 *
 * Usage:
 *   <ThemedScope themeId={u.preferred_theme} lootThemeId={u.loot_theme_id}>
 *     <ProfileCard ... />
 *   </ThemedScope>
 *
 * Pass null/undefined for both to use the viewer's global theme (no override).
 */
export default function ThemedScope({ themeId, lootThemeId, className = '', children }) {
  if (!themeId && !lootThemeId) {
    return <div className={className}>{children}</div>;
  }
  const style = getThemeStyle({ themeId, lootThemeId });
  // Tag animated/legendary loot themes so CSS in src/index.css can target the
  // scoped subtree (e.g. animated card accents) the same way the global
  // <html data-theme-tier="..."> selector works.
  const tier = lootThemeId && isAnimatedTheme({ themeId, lootThemeId }) ? 'animated' : null;
  return (
    <div style={style} className={className} data-theme-tier={tier || undefined}>
      {children}
    </div>
  );
}
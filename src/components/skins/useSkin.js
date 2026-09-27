// src/components/skins/useSkin.js
//
// The one hook the app reads a skin through. Returns the skin whose window
// is open (or null), whether it is on, its parts, and the setter. Optional
// chaining on the context because several tests render app chrome without
// a ThemeProvider.

import { useTheme } from '@/lib/ThemeContext';
import { SKIN_PARTS } from './parts';

export function useSkin() {
  const theme = useTheme();
  const skin = theme?.skin || null;
  return {
    skin,
    on: Boolean(skin && theme?.skinOn),
    parts: (skin && SKIN_PARTS[skin.id]) || null,
    setOn: theme?.setSkinOn || (() => {}),
  };
}

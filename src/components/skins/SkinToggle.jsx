// src/components/skins/SkinToggle.jsx
//
// The on/off switch for whichever skin is in season. Rendered in Settings ›
// Display and at the top of the You tab: a skin changes every screen, so
// the way out has to be one tap from the tab people already use. Renders
// nothing out of season, so it never sits there as a switch that does
// nothing.

import { useLanguage } from '@/lib/LanguageContext';
import { ToggleRow } from '@/components/settings/SettingsPrimitives';
import { useSkin } from './useSkin';

export default function SkinToggle() {
  const { tFallback } = useLanguage();
  const { skin, on, parts, setOn } = useSkin();
  if (!skin) return null;
  return (
    <ToggleRow
      icon={parts?.Icon}
      label={tFallback(...skin.copy.name)}
      hint={tFallback(...skin.copy.hint)}
      checked={on}
      onChange={setOn}
    />
  );
}

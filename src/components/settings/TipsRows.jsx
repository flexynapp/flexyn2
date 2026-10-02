// src/components/settings/TipsRows.jsx
//
// The one-time tips switch and its "show them again" row. They lived under
// About › Help beside Report a bug, which is not where anyone looks for how
// the app behaves (Kegan, 2026-10-02: "why would it be within the report a
// bug menu"). They sit in Preferences › Display now, with the other
// switches for how the app looks and talks to you, and the pill a tip
// shows when you turn tips off points here.

import { useState } from 'react';
import { Lightbulb, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { countSeenTooltips, resetAllSeenTooltips, tipsEnabled, setTipsEnabled } from '@/lib/tooltipRegistry';
import { toast } from '@/lib/toast';
import { ActionRow, ToggleRow } from './SettingsPrimitives';

export default function TipsRows() {
  const { tFallback } = useLanguage();

  // The hints fire once per device and then never again. That "never
  // again" is the point, and it is also a dead end the moment you want to
  // see one: on a new phone, showing someone the app, or checking a hint
  // still lands where it should. Read once on mount rather than live; a
  // hint firing while you are sitting in Settings isn't a case worth a
  // subscription.
  const [seenTips, setSeenTips] = useState(() => countSeenTooltips());
  const [tipsOn, setTipsOn] = useState(() => tipsEnabled());
  const toggleTips = (on) => { setTipsEnabled(on); setTipsOn(on); };

  const resetTips = () => {
    const cleared = resetAllSeenTooltips();
    setSeenTips(0);
    toast.success(
      tFallback(
        'settings.tips.resetDone',
        'Tips reset. They will show again the next time you reach each one.',
      ),
      { description: `${cleared} ${cleared === 1 ? 'tip' : 'tips'} restored` },
    );
  };

  return (
    <>
      <ToggleRow
        icon={Lightbulb}
        label={tFallback('settings.tips.toggle', 'One-time tips')}
        hint={tFallback('settings.tips.toggleHint', 'Small hints that point out shortcuts the first time you reach them')}
        checked={tipsOn}
        onChange={toggleTips}
      />
      {/* Disabled rather than hidden when there is nothing to reset: a row
          that vanishes is harder to find again than one that explains
          itself, and the hint carries the reason. */}
      <ActionRow
        icon={RotateCcw}
        label={tFallback('settings.tips.reset', 'Show one-time tips again')}
        hint={seenTips > 0
          ? tFallback(
              'settings.tips.resetHint',
              'The hints that appear once and never again. Long-press shortcuts, double-tap to react',
            )
          : tFallback(
              'settings.tips.resetNone',
              'No tips to bring back. None have shown on this device yet',
            )}
        onClick={resetTips}
        disabled={seenTips === 0 || !tipsOn}
      />
    </>
  );
}

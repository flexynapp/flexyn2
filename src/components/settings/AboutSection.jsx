// src/components/settings/AboutSection.jsx
//
// Bug report, the build hash, licence attribution, and the moderator
// entry point.
//
// The build label matters more than its size suggests: an installed PWA
// can be months behind main, and a device was once found running a
// ten-week-old build while every server-side check said the backend was
// healthy. Tapping it copies hash + date + UA, which is the first thing to
// ask for when a device report and the database disagree. It stays at the
// bottom of the last page, which is where a diagnostic belongs, but it is
// now a real 44px row rather than 11px of grey text.

import { useState } from 'react';
import { Bug, ShieldAlert, Lightbulb } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { isAppAdmin } from '@/lib/adminRoles';
import { buildLabel, diagnosticString } from '@/lib/buildInfo';
import { countSeenTooltips, resetAllSeenTooltips } from '@/lib/tooltipRegistry';
import { toast } from '@/lib/toast';
import BugReportDialog from '../BugReportDialog';
import { Group, ActionRow, NavRow } from './SettingsPrimitives';

export default function AboutSection() {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const [bugReportOpen, setBugReportOpen] = useState(false);

  // The one-time hints (long-press the tabs, double-tap to react, the PR
  // proximity bar, smart paste) fire once per device and then never again —
  // that "never again" is the point, and it is also a dead end the moment
  // you want to see one: on a new phone, showing someone the app, or
  // checking a hint still lands where it should. Read once on mount rather
  // than live; a hint firing while you are sitting in Settings isn't a case
  // worth a subscription.
  const [seenTips, setSeenTips] = useState(() => countSeenTooltips());

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

  const copyDiagnostics = async () => {
    // Explicitly detect a missing clipboard API rather than letting
    // `navigator.clipboard?.writeText(...)` silently no-op into a resolved
    // Promise<undefined> — that path used to surface a false "Copied!"
    // toast on insecure-context HTTP and on browsers without the API.
    // (Audit 14 #30.)
    if (!navigator?.clipboard?.writeText) {
      toast.error('Clipboard not available. Copy from the diagnostic dialog below.');
      return;
    }
    try {
      await navigator.clipboard.writeText(diagnosticString());
      toast.success('Copied build info to clipboard.');
    } catch {
      toast.error('Could not copy. Your browser blocked clipboard access.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Group title={tFallback('settings.group.help', 'Help')}>
        <ActionRow
          icon={Bug}
          label={t('bugReport.button')}
          onClick={() => setBugReportOpen(true)}
        />
        {/* Disabled rather than hidden when there is nothing to reset: a row
            that vanishes is harder to find again than one that explains
            itself, and the hint carries the reason. */}
        <ActionRow
          icon={Lightbulb}
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
          disabled={seenTips === 0}
        />
        {/* Moderator-only. Gated by isAppAdmin() so it isn't even
            discoverable for everyone else. */}
        {isAppAdmin(user) && (
          <NavRow
            icon={ShieldAlert}
            label={tFallback('settings.admin.reportQueue', 'Open report queue')}
            to="/admin/reports"
            tone="warn"
          />
        )}
      </Group>

      <Group title={tFallback('settings.group.about', 'About')}>
        <ActionRow
          label={buildLabel()}
          hint={tFallback('settings.build.hint', 'Tap to copy build info for a support ticket')}
          onClick={copyDiagnostics}
        />
      </Group>

      {/* Credits — CC-BY 4.0 requires attribution wherever the artwork is
          distributed, and we bake Twemoji into shared images (see
          src/lib/twemoji.js + ATTRIBUTIONS.md). */}
      <p className="px-1 text-caption text-muted-foreground leading-relaxed">
        {tFallback('settings.credits.twemoji', 'Emoji artwork in shared images by')}{' '}
        <a
          href="https://github.com/jdecked/twemoji"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground active:text-foreground transition-colors"
        >
          {tFallback("aboutSection.twemoji", "Twemoji")}
        </a>
        {' '}© Twitter, Inc and other contributors, licensed under{' '}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground active:text-foreground transition-colors"
        >
          CC-BY 4.0
        </a>.
      </p>

      <BugReportDialog open={bugReportOpen} onClose={() => setBugReportOpen(false)} />
    </div>
  );
}

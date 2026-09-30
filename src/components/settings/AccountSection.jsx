// src/components/settings/AccountSection.jsx
//
// Two-factor enrollment, third-party connections, the data export, and
// account deletion.
//
// The first three were adjacent-but-unlabelled in the old panel: 2FA and
// Connected apps rendered their own headings mid-scroll with no parent, and
// "Download my data" sat between a privacy toggle and the bug reporter as
// a bare text button. They are all account-level rather than preference-
// level, which is the distinction this page draws.

import { useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { toast } from '@/lib/toast';
import TwoFactorSection from '../TwoFactorSection';
import ConnectedAppsSection from '../ConnectedAppsSection';
import { requestProfilePanel } from '@/lib/profilePanels';
import { Group, ActionRow } from './SettingsPrimitives';
import { reportError } from '@/lib/reportError';

export default function AccountSection() {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const [exporting, setExporting] = useState(false);

  // One-tap export of all user-owned rows across the known tables.
  // Triggers a JSON file download. The builder is lazy-imported because
  // it pulls a table map nothing else on this page needs.
  const handleDataExport = async () => {
    if (exporting || !user?.id) return;
    setExporting(true);
    try {
      const mod = await import('@/lib/data/dataExport');
      const data = await mod.buildExport(user);
      await mod.downloadExport(data);
      toast.success(tFallback('account.exportDownloaded', 'Data export downloaded.'));
    } catch (err) {
      reportError(err, { feature: 'settings.export' });
      toast.error(tFallback('notice.exportFailed', "Couldn't export your data. Try again."));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Both of these render their own heading and surface — they predate
          the Group primitive and are shared with nothing else, so they are
          left as they are rather than half-converted. */}
      <TwoFactorSection />
      <ConnectedAppsSection />

      <Group title={tFallback('settings.group.yourData', 'Your data')}>
        <ActionRow
          icon={FileText}
          label={exporting
            ? tFallback('settings.export.busy', 'Preparing export…')
            : tFallback('settings.export.action', 'Download my data')}
          hint={tFallback('settings.export.hint', 'Everything on your account, as a JSON file')}
          onClick={handleDataExport}
          busy={exporting}
        />
      </Group>

      {/* Delete account. App Store rules want it easy to find, and Account is
          where people look. ProfileMenu still owns the typed-confirmation
          dialog and the deletion itself; this row only asks it to open, the
          same way the You tab used to. */}
      <Group>
        <ActionRow
          icon={Trash2}
          label={tFallback('profile.deleteAccount', 'Delete account')}
          onClick={() => requestProfilePanel('deleteAccount')}
          tone="destructive"
        />
      </Group>
    </div>
  );
}

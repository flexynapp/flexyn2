// src/hooks/useReadReceiptsEnabled.js
//
// The viewer's OWN read-receipt setting (mig 238), for the reciprocity
// half of the feature: someone who has turned receipts off also stops
// seeing other people's read state.
//
// Reuses the ['userProfile', email] query key + db.auth.me() that
// SettingsPanel already uses, so this costs no extra fetch and the
// toggle's own invalidation refreshes every consumer at once.
//
// Defaults to TRUE in every uncertain case — profile still loading, no
// session, or a pre-238 host where the column doesn't exist yet. The
// setting is opt-OUT, so "unknown" must mean "behave as before".

import { useQuery } from '@tanstack/react-query';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';

export function useReadReceiptsEnabled() {
  const { user } = useAuth();
  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
    staleTime: 60_000,
  });
  // Only an explicit `false` disables. undefined/null → enabled.
  return profile?.read_receipts_enabled !== false;
}

export default useReadReceiptsEnabled;

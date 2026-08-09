// src/components/settings/useSettingsProfile.js
//
// The profile read every Settings subpage needs, plus the invalidate that
// has to follow a write.
//
// Settings used to be one component, so it held one `useQuery` and passed
// `profile` down by closure. Split across seven routed subpages, four of
// them need the row. They all mount the SAME query key, so React Query
// serves the cache rather than refetching — this hook exists to keep that
// key in one place, because a subpage that typo'd it would silently open
// its own cache entry and stop seeing other pages' writes.
//
// `invalidateProfile` is deliberately not a generic invalidate: writers in
// here must ALSO go through `db.auth.updateMe` or call `patchProfile`,
// because `db.auth.me()` serves a module-level cache and an invalidate
// alone refetches straight back into it. See the "Profile cache" section
// of CLAUDE.md — this is the bug that reverted all four privacy toggles.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';

export function useSettingsProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
    staleTime: 60_000,
  });

  const invalidateProfile = () =>
    queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });

  return { user, profile, queryClient, invalidateProfile };
}

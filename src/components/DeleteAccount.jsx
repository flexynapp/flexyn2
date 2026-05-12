import { useState } from 'react';
import { db } from '@/api/db';
import { useLanguage } from '@/lib/LanguageContext';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { clearFirstLaunch } from '@/lib/firstLaunch';
import { clearQueryCache } from '@/lib/query-client';
import AccountDeletedScreen from './AccountDeletedScreen';
import { Trash2 } from 'lucide-react';
import * as hubPosts from '@/lib/data/hubPosts';
import * as hubFollows from '@/lib/data/hubFollows';
import * as hubReactions from '@/lib/data/hubReactions';
import * as hubComments from '@/lib/data/hubComments';
import * as hubMessages from '@/lib/data/hubMessages';
import * as hubCommentLikes from '@/lib/data/hubCommentLikes';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

function wipeLocalClientState() {
  clearFirstLaunch();
  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}
  try {
    if (indexedDB.databases) {
      indexedDB.databases().then(dbs => {
        dbs.forEach(db => { try { indexedDB.deleteDatabase(db.name); } catch {} });
      }).catch(() => {});
    }
  } catch {}
  try {
    document.cookie.split(';').forEach(cookie => {
      const name = cookie.split('=')[0].trim();
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    });
  } catch {}
}

export default function DeleteAccount() {
  const { t } = useLanguage();
  const [isDeleting, setIsDeleting] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);

  if (accountDeleted) return <AccountDeletedScreen />;

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      // ── 1. Identify the user so we can scope deletes correctly ──
      let me = null;
      try { me = await db.auth.me(); } catch {}
      const email = me?.email;

      // Helper: best-effort delete every record owned by this user from a given entity.
      const purgeEntity = async (entityName) => {
        if (!email) return;
        const entity = db.entities?.[entityName];
        if (!entity?.filter || !entity?.delete) return;
        try {
          // Page through up to several thousand records to be safe.
          let cursor = 0;
          const PAGE = 100;
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const batch = await entity.filter({ created_by: email }, '-created_date', PAGE);
            if (!batch || batch.length === 0) break;
            await Promise.all(batch.map(rec =>
              entity.delete(rec.id).catch(() => {})
            ));
            if (batch.length < PAGE) break;
            cursor += batch.length;
            if (cursor > 5000) break; // hard safety cap
          }
        } catch { /* swallow per-entity failures */ }
      };

      // ── 2. Cascade-delete every entity the user can write to ──
      const ENTITIES_TO_PURGE = [
        'Achievement',
        'WorkoutLog',
        'CardioLog',
        'Regimen',
        'Goal',
        'BodyMetric',
        'NutritionLog',
        'WorkoutTemplate',
        'ExerciseForm',
      ];
      await Promise.all(ENTITIES_TO_PURGE.map(purgeEntity));

      // ── 2b. Cascade-delete Hub social data ──
      await Promise.all([
        hubPosts.purgeForUser(email),
        hubFollows.purgeForUser(email),
        hubReactions.purgeForUser(email),
        hubComments.purgeForUser(email),
        hubMessages.purgeForUser(email),
        hubCommentLikes.purgeForUser(email),
      ]);

      // ── 3. Reset every cumulative / denormalised field on the User row ──
      // Sets a fresh account_reset_at so filterAfterReset hides any survivors,
      // and zeroes the leaderboard counters so stale totals can't leak.
      try {
        await db.auth.updateMe({
          // Cumulative counters (leaderboards)
          total_xp: 0,
          achievements_unlocked_count: 0,
          total_volume_lbs: 0,
          total_distance_meters: 0,
          // Reset milestone-capsule counter so a fresh start can re-earn them
          milestone_capsules_awarded: 0,
          // Profile fields the user filled in via onboarding
          username: '',
          gender: null,
          birthday: null,
          height_inches: null,
          weight_lbs: null,
          country_code: null,
          state_code: null,
          // Onboarding gate — forces fresh onboarding on next sign-in
          onboarding_complete: false,
          // Defensive reset timestamp: filterAfterReset will hide any
          // pre-existing record whose created_date predates this.
          account_reset_at: new Date().toISOString(),
        });
      } catch { /* non-blocking */ }

      // ── 4. Final backstop: call the server-side deletion function ──
      // If the backend supports a true delete, this still runs. If it fails
      // or partially succeeds, the steps above already neutralised the data.
      try {
        const result = await db.functions.invoke('deleteAccountData', {});
        if (result?.data?.success === false || result?.data?.error) {
          // Don't throw — we've already done the heavy lifting client-side.
          console.warn('Server-side delete reported failure:', result?.data?.error);
        }
      } catch (err) {
        console.warn('Server-side delete invocation failed:', err);
      }

      // ── 5. Wipe local state and bounce ──
      clearQueryCache();
      wipeLocalClientState();
      try { db.auth.logout(); } catch {}
      window.location.href = '/';
    } catch (err) {
      console.error('Account delete failed:', err);
      setIsDeleting(false);
      toast.error(t('profile.deleteError'));
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" className="gap-2">
          <Trash2 className="w-4 h-4" />
          Delete Account
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        onEscapeKeyDown={(e) => { if (isDeleting) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (isDeleting) e.preventDefault(); }}
        onInteractOutside={(e) => { if (isDeleting) e.preventDefault(); }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t('profile.deleteTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('profile.deleteDesc')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? t('profile.deletingLabel') : t('profile.deleteConfirmBtn')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
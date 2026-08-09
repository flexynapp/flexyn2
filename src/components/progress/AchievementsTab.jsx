// src/components/progress/AchievementsTab.jsx
//
// Inline (non-modal) version of AchievementsModal. Mounts directly inside the
// Progress page tab grid so achievements feel like a first-class section
// rather than a hidden popup.

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Lock, Star, LockKeyhole, Share2, Loader2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { ACHIEVEMENT_DEFINITIONS } from '@/lib/achievementDefinitions';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { shareAchievementPost } from '@/lib/data/shareAchievement';
import { useDateFormatter } from '@/lib/intl';
import EmptyState from '@/components/EmptyState';

// Four of these six used to be raw yellow / emerald / purple / orange
// while the other two were already tokens — the file was half-migrated.
// They now collapse onto three budget values, and several categories
// share one. That's fine and deliberate: this is a background TINT on a
// card that already shows the achievement's icon and title, so the
// colour was never the thing telling you which category you're looking
// at. Don't reintroduce a per-category hue to "fix" the duplication.
const CATEGORY_COLORS = {
  workout:    'bg-primary/10 text-primary',
  regimen:    'bg-accent/10 text-accent',
  goal:       'bg-primary/10 text-primary',
  nutrition:  'bg-success/10 text-success',
  milestone:  'bg-primary/10 text-primary',
  cardio:     'bg-primary/10 text-primary',
};

export default function AchievementsTab({ achievements = [] }) {
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const fmtDate = useDateFormatter();
  const [activeSubTab, setActiveSubTab] = useState('active');
  // Tracks the achievement_id currently being shared so the button can
  // disable + show a spinner. Single-flight — only one share at a time.
  const [sharingId, setSharingId] = useState(null);

  const handleShareAchievement = async (ach) => {
    if (sharingId) return;
    setSharingId(ach.achievement_id);
    let res;
    try {
      res = await shareAchievementPost({
        user,
        achievement: {
          ...ach,
          name:        tFallback(ach.nameKey,        ach.name),
          description: tFallback(ach.descriptionKey, ach.description),
        },
      });
    } catch (err) {
      // shareAchievementPost is expected to return { ok, error } but
      // a network blip can still throw — without this catch the user
      // saw nothing on failure and the sharingId state never cleared,
      // permanently locking the share button. Report so observability
      // catches a real regression.
      try {
        const { reportError } = await import('@/lib/reportError');
        reportError(err, {
          feature: 'achievements.share',
          level: 'warning',
          userEmail: user?.email,
          achievementId: ach.achievement_id,
        });
      } catch { /* reportError unavailable */ }
      res = { ok: false, error: err?.message || 'network' };
    } finally {
      setSharingId(null);
    }
    if (res.ok) {
      toast.success(tFallback('achievements.shareSuccess', 'Shared to Hub!'));
    } else {
      toast.error(tFallback(
        'achievements.shareFailed',
        "Couldn't share: {reason}",
        { reason: res.error || 'try again' },
      ));
    }
  };

  const achievementMap = useMemo(() => {
    const map = {};
    achievements.forEach((a) => { map[a.achievement_id] = a; });
    return map;
  }, [achievements]);

  const categorized = useMemo(() => {
    const cats = { workout: [], regimen: [], goal: [], nutrition: [], milestone: [], cardio: [] };
    ACHIEVEMENT_DEFINITIONS.forEach((def) => {
      const userAch = achievementMap[def.achievement_id];
      if (cats[def.category]) {
        cats[def.category].push({
          ...def,
          id: userAch?.id,
          // The achievements table only has `unlocked_at` (row presence =
          // unlocked); the old `unlocked`/`unlocked_date` columns never
          // existed, so every badge rendered locked. Treat a fetched row
          // as unlocked and use unlocked_at for the date.
          unlocked: !!userAch,
          unlockedDate: userAch?.unlocked_at,
          progress: userAch?.progress || 0,
        });
      }
    });
    Object.keys(cats).forEach(cat => {
      cats[cat].sort((a, b) => (a.unlocked === b.unlocked ? 0 : a.unlocked ? 1 : -1));
    });
    return cats;
  }, [achievementMap]);

  const activeAch = useMemo(() => {
    const out = {};
    Object.keys(categorized).forEach(c => { out[c] = categorized[c].filter(a => !a.unlocked); });
    return out;
  }, [categorized]);

  const completedAch = useMemo(() => {
    const out = {};
    Object.keys(categorized).forEach(c => { out[c] = categorized[c].filter(a => a.unlocked); });
    return out;
  }, [categorized]);

  const displayData = activeSubTab === 'active' ? activeAch : completedAch;
  // The achievements table stores ONLY unlocked rows (presence = unlocked,
  // there's no `unlocked` boolean column). The previous version filtered
  // by `a.unlocked` which is undefined on every row, so the header
  // permanently showed "0 / total" even when the user had unlocks.
  // (Audit 11 #2.)
  const unlockedCount = achievements.length;
  const totalCount = ACHIEVEMENT_DEFINITIONS.length;
  const progressPct = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

  return (
    <div>
      {/* Header — collection progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-primary" />
            <h2 className="font-heading font-bold text-lg">{t('progress.achievements')}</h2>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {unlockedCount} / {totalCount}
          </span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-primary transition-[width] duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Sub-tabs: active / completed */}
      <div className="flex gap-2 border-b border-border mb-6">
        <button
          onClick={() => setActiveSubTab('active')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSubTab === 'active'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground active:text-foreground'
          }`}
        >
          {t('progress.activeAchievements')}
        </button>
        <button
          onClick={() => setActiveSubTab('completed')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSubTab === 'completed'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground active:text-foreground'
          }`}
        >
          {t('progress.completedAchievements')}
        </button>
      </div>

      <div className="space-y-6">
        {Object.entries(displayData).map(([category, cats]) => {
          if (cats.length === 0) return null;
          return (
            <div key={category}>
              <h3 className="font-heading font-bold text-sm mb-3 capitalize">
                {tFallback(`achievementDefs.cat.${category}`, category)}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* In Progress ↔ Completed swaps every card in this grid, so
                    under the default sync mode all of the outgoing cards held
                    their cells while the incoming set was appended below —
                    the grid grew to roughly double height and then collapsed
                    back once the exits unmounted. popLayout takes them out of
                    flow immediately, so the new set lands where it belongs on
                    the first frame. The grid spaces with `gap`, not `space-y`
                    margins, which is what makes this safe — see
                    src/lib/listMotion.js. */}
                <AnimatePresence mode="popLayout">
                  {cats.map((ach) => (
                    <motion.div
                      key={ach.achievement_id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                    >
                      <Card
                        className={`p-4 border-none shadow-sm transition-all ${
                          ach.unlocked ? `${CATEGORY_COLORS[category]} bg-opacity-20` : 'bg-muted/50'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="relative flex-shrink-0 w-10 h-10 flex items-center justify-center">
                            {/* Always show the actual icon; grey + desaturate when locked */}
                            <span
                              className="text-3xl leading-none"
                              style={!ach.unlocked ? {
                                filter: 'grayscale(1) brightness(0.45)',
                                opacity: 0.7,
                              } : {}}
                            >
                              {ach.icon}
                            </span>
                            {/* Small lock badge pinned to bottom-right corner */}
                            {!ach.unlocked && (
                              <span className="absolute -bottom-1 -end-1 w-4 h-4 rounded-full bg-muted border border-border flex items-center justify-center shadow-sm">
                                <LockKeyhole className="w-2.5 h-2.5 text-muted-foreground" />
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-sm">{tFallback(ach.nameKey, ach.name)}</p>
                                <p className={`text-xs mt-0.5 ${
                                  ach.unlocked ? 'text-muted-foreground' : 'text-muted-foreground/70'
                                }`}>
                                  {tFallback(ach.descriptionKey, ach.description)}
                                </p>
                              </div>
                              {ach.unlocked && (
                                <Badge className="text-xs bg-success text-white shrink-0">
                                  <Star className="w-2.5 h-2.5 me-1" /> +{ach.xp_reward} XP
                                </Badge>
                              )}
                            </div>
                            {!ach.unlocked && ach.target > 1 && (
                              <div className="mt-2">
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-xs text-muted-foreground tabular-nums">
                                    {Math.round(ach.progress)} / {ach.target}
                                  </span>
                                  <span className="text-xs font-medium tabular-nums">
                                    {Math.round((ach.progress / ach.target) * 100)}%
                                  </span>
                                </div>
                                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-primary transition-all duration-300"
                                    style={{
                                      width: `${Math.min((ach.progress / ach.target) * 100, 100)}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                            {ach.unlocked && ach.unlockedDate && (
                              <div className="flex items-center justify-between gap-2 mt-2">
                                <p className="text-xs text-muted-foreground">
                                  {t('progress.unlockedOn')}{' '}
                                  {fmtDate(ach.unlockedDate)}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => handleShareAchievement(ach)}
                                  disabled={sharingId === ach.achievement_id}
                                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-micro font-bold uppercase tracking-wide text-primary hover:bg-primary/10 active:bg-primary/10 transition-colors disabled:opacity-50"
                                  aria-label="Share to Hub"
                                >
                                  {sharingId === ach.achievement_id
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <Share2 className="w-3 h-3" />}
                                  Share
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          );
        })}

        {activeSubTab === 'active' && Object.values(displayData).every(arr => arr.length === 0) && (
          <EmptyState
            icon={Trophy}
            title={tFallback('progress.allCompletedTitle', 'Everything unlocked!')}
            body={t('progress.allCompleted')}
          />
        )}
        {activeSubTab === 'completed' && Object.values(displayData).every(arr => arr.length === 0) && (
          <EmptyState
            icon={Lock}
            title={tFallback('progress.noneCompletedTitle', 'No badges yet')}
            body={t('progress.noneCompleted')}
          />
        )}
      </div>
    </div>
  );
}

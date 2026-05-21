// src/components/progress/AchievementsTab.jsx
//
// Inline (non-modal) version of AchievementsModal. Mounts directly inside the
// Progress page tab grid so achievements feel like a first-class section
// rather than a hidden popup.

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Lock, Star, LockKeyhole } from 'lucide-react';
import { ACHIEVEMENT_DEFINITIONS } from '@/lib/achievementDefinitions';
import { useLanguage } from '@/lib/LanguageContext';

const CATEGORY_COLORS = {
  workout:    'bg-primary/10 text-primary',
  regimen:    'bg-accent/10 text-accent',
  goal:       'bg-yellow-500/10 text-yellow-600',
  nutrition:  'bg-emerald-500/10 text-emerald-600',
  milestone:  'bg-purple-500/10 text-purple-600',
  cardio:     'bg-orange-500/10 text-orange-600',
};

export default function AchievementsTab({ achievements = [] }) {
  const { t } = useLanguage();
  const [activeSubTab, setActiveSubTab] = useState('active');

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
          unlocked: userAch?.unlocked || false,
          unlockedDate: userAch?.unlocked_date,
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
  const unlockedCount = achievements.filter((a) => a.unlocked).length;
  const totalCount = ACHIEVEMENT_DEFINITIONS.length;
  const progressPct = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

  return (
    <div>
      {/* Header — collection progress bar */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-yellow-500" />
            <h2 className="font-heading font-bold text-lg">{t('progress.achievements')}</h2>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {unlockedCount} / {totalCount}
          </span>
        </div>
        <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-yellow-400 to-yellow-600 transition-[width] duration-500"
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
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t('progress.activeAchievements')}
        </button>
        <button
          onClick={() => setActiveSubTab('completed')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSubTab === 'completed'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
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
                {t(`achievementDefs.cat.${category}`) || category}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <AnimatePresence>
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
                              <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-muted border border-border flex items-center justify-center shadow-sm">
                                <LockKeyhole className="w-2.5 h-2.5 text-muted-foreground" />
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="font-semibold text-sm">{t(ach.nameKey)}</p>
                                <p className={`text-xs mt-0.5 ${
                                  ach.unlocked ? 'text-muted-foreground' : 'text-muted-foreground/70'
                                }`}>
                                  {t(ach.descriptionKey)}
                                </p>
                              </div>
                              {ach.unlocked && (
                                <Badge className="text-xs bg-green-600 text-white shrink-0">
                                  <Star className="w-2.5 h-2.5 mr-1" /> +{ach.xp_reward} XP
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
                              <p className="text-xs text-muted-foreground mt-2">
                                {t('progress.unlockedOn')}{' '}
                                {new Date(ach.unlockedDate).toLocaleDateString()}
                              </p>
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
          <div className="text-center py-8">
            <Trophy className="w-10 h-10 text-yellow-500 mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">{t('progress.allCompleted')}</p>
          </div>
        )}
        {activeSubTab === 'completed' && Object.values(displayData).every(arr => arr.length === 0) && (
          <div className="text-center py-8">
            <Lock className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">{t('progress.noneCompleted')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

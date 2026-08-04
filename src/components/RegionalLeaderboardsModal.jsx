// src/components/RegionalLeaderboardsModal.jsx
// Regional Leaderboards — ranks users filtered by country (and US state).
import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Crown, Trophy, Flame, Sparkles, Dumbbell, Footprints, Award, Zap, MapPin, Map } from 'lucide-react';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { formatDistance } from '@/lib/distanceUnit';
import { calculateLevelFromXp } from '@/lib/xpSystem';
import { backfillLeaderboardStatsOnce } from '@/lib/leaderboardStats';
import { COUNTRIES, US_STATES, getCountry, getUsState } from '@/lib/regions';
import { useNumberFormatter } from '@/lib/intl';

const BOARDS = [
  { id: 'level',        icon: Zap,        labelKey: 'leaderboards.level',        gradient: 'from-sky-400 via-blue-500 to-indigo-600' },
  { id: 'achievements', icon: Award,      labelKey: 'leaderboards.achievements', gradient: 'from-blue-400 via-indigo-500 to-violet-600' },
  { id: 'volume',       icon: Dumbbell,   labelKey: 'leaderboards.volume',       gradient: 'from-teal-400 via-cyan-500 to-sky-600' },
  { id: 'distance',     icon: Footprints, labelKey: 'leaderboards.distance',     gradient: 'from-indigo-400 via-blue-500 to-cyan-500' },
];

const PODIUM_STYLE = {
  0: { ring: 'ring-yellow-400/60',  glow: 'shadow-yellow-400/40',  Icon: Crown,  iconColor: 'text-yellow-400'  },
  1: { ring: 'ring-slate-300/60',   glow: 'shadow-slate-300/30',   Icon: Trophy, iconColor: 'text-slate-300'   },
  2: { ring: 'ring-orange-400/60',  glow: 'shadow-orange-400/40',  Icon: Flame,  iconColor: 'text-orange-400'  },
};

export default function RegionalLeaderboardsModal({ open, onClose }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();
  const fmt = useNumberFormatter();
  const formatNum = (n) => fmt(Math.round(n));
  const [activeBoard, setActiveBoard] = useState('level');
  const [activeCountry, setActiveCountry] = useState(null);
  const [activeState, setActiveState] = useState(null);

  useEffect(() => {
    if (open && user?.email) backfillLeaderboardStatsOnce(user.email);
  }, [open, user?.email]);

  // Default the picker to the user's own region the first time the modal opens.
  useEffect(() => {
    if (open && user) {
      if (user.country_code && !activeCountry) setActiveCountry(user.country_code);
      if (user.country_code === 'US' && user.state_code && !activeState) setActiveState(user.state_code);
    }
  }, [open, user, activeCountry, activeState]);

  const { data: allUsers = [], isLoading } = useQuery({
    queryKey: ['allUsersLeaderboards'],
    queryFn: () => db.entities.User.list(),
    enabled: open,
  });

  const board = BOARDS.find(b => b.id === activeBoard);

  const ranked = useMemo(() => {
    let pool = [];
    if (activeCountry) {
      pool = allUsers.filter(u => u.country_code === activeCountry);
      if (activeCountry === 'US' && activeState) {
        pool = pool.filter(u => u.state_code === activeState);
      } else if (activeCountry === 'US' && !activeState) {
        pool = []; // US needs a state pick before showing rankings
      }
    }

    const enriched = pool.map(u => {
      const xp = Number(u.total_xp) || 0;
      const lvl = calculateLevelFromXp(xp);
      return {
        id: u.id,
        full_name: u.full_name || t('progress.anonymous'),
        total_xp: xp,
        level: lvl.level,
        achievements_unlocked_count: Number(u.achievements_unlocked_count) || 0,
        total_volume_lbs: Number(u.total_volume_lbs) || 0,
        total_distance_meters: Number(u.total_distance_meters) || 0,
      };
    });

    const filteredEnriched = enriched.filter(u => {
      // Hide ghost users — those whose every counter is zero AFTER backfill.
      // These are typically deleted-then-re-registered accounts where the User
      // row exists but every entity has been purged. The per-board valueOf > 0
      // filter below would still show them on other boards if they had any
      // non-zero counter, so we drop them here unconditionally.
      return (Number(u.total_xp) || 0) > 0
          || (Number(u.achievements_unlocked_count) || 0) > 0
          || (Number(u.total_volume_lbs) || 0) > 0
          || (Number(u.total_distance_meters) || 0) > 0;
    });

    let valueOf, formatValue;
    switch (activeBoard) {
      case 'achievements':
        valueOf = u => u.achievements_unlocked_count;
        formatValue = v => `${formatNum(v)} ${t('leaderboards.unlocked')}`;
        break;
      case 'volume':
        valueOf = u => u.total_volume_lbs;
        formatValue = v => `${formatNum(fromLbs(v, weightUnit))} ${weightUnit}`;
        break;
      case 'distance':
        valueOf = u => u.total_distance_meters;
        formatValue = v => formatDistance(v, distanceUnit, 1);
        break;
      case 'level':
      default:
        valueOf = u => u.total_xp;
        formatValue = (_v, u) => `Lv ${u.level} · ${formatNum(u.total_xp)} XP`;
        break;
    }

    return filteredEnriched
      .filter(u => valueOf(u) > 0)
      .sort((a, b) => valueOf(b) - valueOf(a))
      .slice(0, 100)
      .map((u, idx) => ({ ...u, rank: idx + 1, _val: valueOf(u), _display: formatValue(valueOf(u), u) }));
  }, [allUsers, activeBoard, weightUnit, distanceUnit, t, activeCountry, activeState]);

  const myRow = ranked.find(r => r.id === user?.id);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[88vh] overflow-y-auto p-0 gap-0"
        onInteractOutside={(e) => {
          const target = e.target;
          const isOverlay = target?.hasAttribute('data-radix-dialog-overlay') ||
            target?.closest('[data-radix-dialog-overlay]') !== null ||
            target?.classList?.contains('bg-black\\/80');
          if (!isOverlay) {
            e.preventDefault();
          }
        }}
        onEscapeKeyDown={onClose}
      >
        {/* Hero */}
        <div className={`relative overflow-hidden bg-gradient-to-br ${board.gradient} px-5 sm:px-6 pt-6 pb-7 sm:pb-8 text-white`}>
          <motion.div
            className="absolute inset-0 opacity-30"
            style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(255,255,255,0.4) 0%, transparent 60%), radial-gradient(circle at 80% 30%, rgba(255,255,255,0.3) 0%, transparent 50%)' }}
            animate={{ opacity: [0.2, 0.4, 0.2] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
          <DialogHeader className="relative z-10">
            <DialogTitle className="font-heading text-xl sm:text-2xl md:text-3xl flex items-center gap-2 text-white drop-shadow pe-8">
              <Map className="w-6 h-6" />
              {t('leaderboards.regional.title')}
            </DialogTitle>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-sm text-white/85">{t('leaderboards.regional.subtitle')}</p>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-md text-micro font-bold tracking-wider text-white">
                ✨ {t('leaderboards.top100')}
              </span>
            </div>
          </DialogHeader>

          {/* Metric pills */}
          <div className="relative z-10 mt-5 flex flex-wrap gap-1.5 sm:gap-2 pe-8">
            {BOARDS.map(b => {
              const Icon = b.icon;
              const active = b.id === activeBoard;
              return (
                <motion.button
                  key={b.id}
                  onClick={() => setActiveBoard(b.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md transition-colors ${
                    active ? 'bg-white text-foreground shadow-lg' : 'bg-white/15 text-white hover:bg-white/25 active:bg-white/25'
                  }`}
                  whileTap={{ scale: 0.94 }}
                  layout
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t(b.labelKey)}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 md:p-6">
          {/* Region pickers — native selects so they expand into a touch-friendly dropdown
              on every platform and never force horizontal scrolling. */}
          <div className="mb-5 space-y-3">
            <div>
              <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-1.5 block">
                {t('leaderboards.region.country')}
              </label>
              <div className="relative">
                <select
                  value={activeCountry || ''}
                  onChange={(e) => {
                    const code = e.target.value || null;
                    setActiveCountry(code);
                    if (code !== 'US') setActiveState(null);
                  }}
                  className="w-full h-11 ps-10 pe-9 rounded-xl border border-border bg-card text-sm font-medium appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="">{t('leaderboards.region.pickCountry')}</option>
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.code}>
                      {c.flag}  {c.name}
                    </option>
                  ))}
                </select>
                {activeCountry && (
                  <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-lg">
                    {getCountry(activeCountry)?.flag}
                  </span>
                )}
                <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                  ▼
                </span>
              </div>
            </div>

            <AnimatePresence>
              {activeCountry === 'US' && (
                <motion.div
                  key="state-dropdown"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase mb-1.5 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {t('leaderboards.region.state')}
                  </label>
                  <div className="relative">
                    <select
                      value={activeState || ''}
                      onChange={(e) => setActiveState(e.target.value || null)}
                      className="w-full h-11 px-3 pe-9 rounded-xl border border-border bg-card text-sm font-medium appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="">{t('leaderboards.region.pickState')}</option>
                      {US_STATES.map(s => (
                        <option key={s.code} value={s.code}>{s.name}</option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
                      ▼
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Region context strip — confirms what's currently in view */}
            {activeCountry && (activeCountry !== 'US' || activeState) && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Map className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {t('leaderboards.region.viewing')}{' '}
                  <span className="font-semibold text-foreground">
                    {activeCountry === 'US' && activeState
                      ? `${getUsState(activeState)?.name}, USA`
                      : getCountry(activeCountry)?.name}
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* Current user card */}
          {myRow && (
            <motion.div key={`me-${activeBoard}`} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
              <Card className="p-4 bg-primary/5 border-2 border-primary/30">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-primary/20 flex items-center justify-center shrink-0 font-heading font-bold text-primary">
                    #{myRow.rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-heading font-bold text-sm">{t('progress.you')}</p>
                    <p className="text-xs text-muted-foreground truncate">{myRow.full_name}</p>
                  </div>
                  <div className="text-end">
                    <p className="font-heading font-bold text-base text-primary">{myRow._display}</p>
                  </div>
                </div>
              </Card>
            </motion.div>
          )}

          {/* List */}
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : ranked.length === 0 ? (
            <div className="text-center py-12">
              <Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-heading font-semibold">
                {!activeCountry
                  ? t('leaderboards.region.pickCountry')
                  : activeCountry === 'US' && !activeState
                  ? t('leaderboards.region.pickState')
                  : t('leaderboards.empty')}
              </p>
              <p className="text-sm text-muted-foreground mt-1">{t('leaderboards.region.emptyDesc')}</p>
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activeCountry || ''}-${activeState || ''}-${activeBoard}`}
                className="space-y-2"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
              >
                {ranked.map((row, idx) => {
                  const podium = PODIUM_STYLE[idx];
                  const isMe = row.id === user?.id;
                  return (
                    <motion.div
                      key={row.id}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(idx, 10) * 0.04 }}
                    >
                      <Card className={`p-3 border-none shadow-sm transition-all ${
                        podium ? `ring-2 ${podium.ring} shadow-md ${podium.glow}` : ''
                      } ${isMe ? 'bg-primary/10 border-2 border-primary/30' : ''}`}>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-secondary">
                            {podium ? (
                              <podium.Icon className={`w-4 h-4 ${podium.iconColor}`} />
                            ) : (
                              <span className="font-heading font-bold text-xs">#{row.rank}</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-heading font-bold text-sm truncate">{row.full_name}</p>
                          </div>
                          <div className="flex-shrink-0 text-end">
                            <p className="font-heading font-bold text-sm">{row._display}</p>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
                {ranked.length >= 100 ? (
                  <p className="text-xs text-center text-muted-foreground mt-4">
                    {t('leaderboards.top100Footer')}
                  </p>
                ) : ranked.length > 5 && (
                  <p className="text-xs text-center text-muted-foreground mt-4">
                    {t('leaderboards.allShownFooter').replace('{n}', ranked.length)}
                  </p>
                )}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
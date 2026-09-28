// src/components/QuickLogSheet.jsx
//
// The + in the middle of the tab bar (navigation redesign, phases 2 and 4).
// Logging is the thing people open a fitness app to do, and before this
// each kind of log lived on a different tab: meals on Nutrition, weight
// and photos on the Dashboard, a post on Hub. Nutrition stopped being a
// tab in this redesign on the understanding that meals are logged from
// here, so this sheet is what keeps that promise.
//
// Two kinds of tile. Water is one number, so it logs in the sheet itself
// and you never leave the page you were on (phase 4). It saves through the
// same code the Nutrition page uses (waterLogging.js), so XP and quests
// cannot drift between the two paths. The inline form REPLACES the grid
// rather than opening a dialog over it: sheets never stack.
//
// Weight had a tile here too until 2026-09-27, when Kegan swapped it for
// Cardio: cardio is a session people log often, weight is a number most
// people record rarely. Weight is still one tap from Today's quick
// actions ("Log weight"), from Progress, and from this sheet's search.
//
// Everything else routes to a deep link the destination page already
// honours. Navigation REPLACES the history entry the open sheet pushed
// (see useOverlayBackButton). Pushing would leave that entry behind, so
// Back from the destination would land on a sheet that is no longer there
// and need a second press.
//
// The search box finds any screen by name. The redesign moved a dozen
// destinations under You and Social, and a search is the one route to
// them that does not require knowing where they went.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dumbbell, Utensils, Droplet, Activity, Scale, Camera, PenSquare, Search, ChevronLeft, ChevronRight,
  TrendingUp, Apple, MessageCircle, ShoppingBag, Backpack, Trophy, Settings, Book,
  CalendarCheck, ShieldAlert, Swords, Target, Crosshair, Mountain, Medal, Users, UserSearch, Sparkles,
} from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { triggerHaptic } from '@/lib/haptic';
import { reportError } from '@/lib/reportError';
import * as nutritionData from '@/lib/data/nutrition';
import { waterFoodName } from '@/lib/waterEntries';
import { rewardWaterLog, WATER_DAILY_CAP_OZ } from '@/lib/waterLogging';
import { useTodayFuel } from '@/hooks/useTodayFuel';
import useCountUp from '@/hooks/useCountUp';
import { useButtonAnswer, answerClassName, AnswerLabel } from '@/components/feedback/buttonAnswer';
import { requestOpenJournal } from '@/lib/journalOverlay';
import { requestOpenBag } from '@/lib/inventoryFlow';
import { OPEN_ACHIEVEMENTS_EVENT } from '@/lib/achievementsFlow';
import { requestProfilePanel } from '@/lib/profilePanels';

// `to` is where the tile would go if it navigated. Water carries `inline`,
// which is what the sheet does instead; `to` stays as the full page for
// the "more" link inside its panel. Cardio opens the Workout page's cardio
// sheet through the deep link the daily-quest CTAs already use.
export const QUICK_LOG_ITEMS = [
  { id: 'workout', icon: Dumbbell,  to: '/workout?freestyle=1',     key: 'quickLog.workout', en: 'Workout' },
  { id: 'meal',    icon: Utensils,  to: '/nutrition?openLogMeal=1', key: 'quickLog.meal',    en: 'Meal' },
  { id: 'water',   icon: Droplet,   to: '/nutrition',               key: 'quickLog.water',   en: 'Water', inline: true },
  { id: 'cardio',  icon: Activity,  to: '/workout?openCardio=1',    key: 'quickLog.cardio',  en: 'Cardio' },
  { id: 'photo',   icon: Camera,    to: '/dashboard?addPhoto=1',    key: 'quickLog.photo',   en: 'Progress photo' },
  { id: 'post',    icon: PenSquare, to: '/hub?compose=1',           key: 'quickLog.post',    en: 'Post' },
];

export const WATER_STEPS_OZ = [8, 16];

const openAchievements = () => {
  try { window.dispatchEvent(new CustomEvent(OPEN_ACHIEVEMENTS_EVENT)); } catch { /* ignore */ }
};

// Every screen a search can reach. Labels reuse the keys the screens' own
// entry points use, so a result reads exactly like the row it stands for.
// `terms` are extra English words people search by; the translated label
// is always searched too.
export const SEARCH_INDEX = [
  { id: 'progress',     icon: TrendingUp,    key: 'nav.progress',          en: 'Progress',         to: '/progress',          terms: 'stats charts prs records' },
  { id: 'weight',       icon: Scale,         key: 'dashboard.logWeight',   en: 'Log weight',       to: '/dashboard?logWeight=1', terms: 'body weigh scale bodyweight' },
  { id: 'nutrition',    icon: Apple,         key: 'nav.nutrition',         en: 'Nutrition',        to: '/nutrition',         terms: 'food meals calories macros water diet' },
  { id: 'coach',        icon: Sparkles,           key: 'search.coach',          en: 'AI Coach',         to: '/coach',             terms: 'plan program generate' },
  { id: 'messages',     icon: MessageCircle, key: 'search.messages',       en: 'Messages',         to: '/messages',          terms: 'chat dm inbox' },
  { id: 'people',       icon: UserSearch,    key: 'search.people',         en: 'Find people',      to: '/hub?search=open',   terms: 'friends users follow search' },
  { id: 'crews',        icon: Users,         key: 'search.crews',          en: 'Crews',            to: '/hub?feed=crews',    terms: 'team group' },
  { id: 'compete',      icon: Medal,         key: 'search.compete',        en: 'Compete',          to: '/hub?feed=compete',  terms: 'league leaderboards rank' },
  { id: 'crewwars',     icon: Swords,        key: 'crewWars.title',        en: 'Crew Wars',        to: '/hub?feed=compete',  terms: 'war battle' },
  { id: 'duels',        icon: Target,        key: 'duels.title',           en: 'Duels',            to: '/duels',             terms: 'challenge versus' },
  { id: 'bounties',     icon: Crosshair,     key: 'bounties.title',        en: 'Bounties',         to: '/bounties',          terms: 'record' },
  { id: 'gauntlet',     icon: Mountain,      key: 'compete.gauntlet',      en: 'Gauntlet',         to: '/gauntlet',          terms: 'weekly path' },
  { id: 'rewards',      icon: ShoppingBag,   key: 'you.rewards',           en: 'Rewards',          to: '/market',            terms: 'market shop store coins chest' },
  { id: 'gym',          icon: Dumbbell,      key: 'profile.myGym',         en: 'My Gym',           to: '/my-gym',            terms: 'gym location map' },
  { id: 'settings',     icon: Settings,      key: 'profile.settings',      en: 'Settings',         to: '/settings',          terms: 'preferences notifications units language privacy' },
  { id: 'bag',          icon: Backpack,      key: 'profile.myBag',         en: 'My Bag',           run: requestOpenBag,      terms: 'inventory items capsules' },
  { id: 'achievements', icon: Trophy,        key: 'profile.achievements',  en: 'Achievements',     run: openAchievements,    terms: 'badges trophies' },
  { id: 'journal',      icon: Book,          key: 'profile.myJournal',     en: 'My Journal',       run: () => requestOpenJournal(), terms: 'diary notes sleep mood' },
  { id: 'reviews',      icon: CalendarCheck, key: 'profile.debriefVault',  en: 'Weekly Reviews',   run: () => requestProfilePanel('reviews'), terms: 'debrief recap summary' },
  { id: 'injuries',     icon: ShieldAlert,   key: 'profile.myInjuries',    en: 'My Injuries',      run: () => requestProfilePanel('injuries'), terms: 'injury pain' },
];

const norm = (s) => String(s || '').toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Every word of the query must appear somewhere in the label or terms, so
// "crew war" finds Crew Wars and "weekly" finds both Weekly Reviews and
// the Gauntlet.
export function searchScreens(query, label = (item) => item.en) {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return SEARCH_INDEX.filter((item) => {
    const hay = norm(`${label(item)} ${item.en} ${item.terms || ''}`);
    return words.every((w) => hay.includes(w));
  });
}

function PanelHeader({ title, onBack, backLabel }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="min-h-12 min-w-12 -ms-3 flex items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
        aria-label={backLabel}
      >
        <ChevronLeft className="w-5 h-5 rtl:scale-x-[-1]" aria-hidden="true" />
      </button>
      <h3 className="font-heading text-lg font-bold">{title}</h3>
    </div>
  );
}

// One +oz button. It answers for itself instead of raising a message
// (components/feedback/buttonAnswer.jsx): a drawn check and "Added", or
// "Didn't save" if the write failed. Kegan's screenshot of the old
// "Added 8 oz of water" box sitting on top of these two buttons is why.

function WaterStepButton({ oz, label, disabled, onLog }) {
  const { tFallback } = useLanguage();
  const answer = useButtonAnswer();

  const press = async () => {
    answer.reset();
    const result = await onLog(oz);
    if (result === 'ok') answer.succeed();
    else if (result === 'failed') answer.fail();
  };

  return (
    <Button
      type="button"
      className={`min-h-12 ${answerClassName(answer.phase)}`}
      disabled={disabled}
      onClick={press}
    >
      <AnswerLabel
        phase={answer.phase}
        idle={label}
        done={tFallback('quickLog.waterAddedShort', 'Added')}
        failed={tFallback('quickLog.waterFailedShort', "Didn't save")}
      />
    </Button>
  );
}

function WaterPanel({ userProfile, onBack, onDone }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const queryClient = useQueryClient();
  const { today, waterOz, waterGoal } = useTodayFuel(userProfile);
  // The line under the buttons: why a tap did not log (the daily cap, a
  // failed save). It replaces the two toasts this panel used to raise.
  const [note, setNote] = useState(null);

  // Tapped ounces not yet reflected in today's logs. The total counts up the
  // moment the save lands instead of waiting for the refetch, and drops back
  // to the fetched value once that arrives (which already includes them).
  const [pendingOz, setPendingOz] = useState(0);
  useEffect(() => { setPendingOz(0); }, [waterOz]);
  const shownOz = useCountUp(waterOz + pendingOz, { duration: 500, animateOnMount: false });

  const add = useMutation({
    mutationFn: (oz) => nutritionData.create({ date: today, food_name: waterFoodName(oz), calories: 0 }),
    onSuccess: (_row, oz) => {
      setPendingOz((p) => p + oz);
      queryClient.invalidateQueries({ queryKey: ['nutritionLogs'] });
      rewardWaterLog({ user, date: today, oz, queryClient, via: 'quick_log' });
    },
    onError: (err) => {
      reportError(err, { feature: 'quickLog.water', userEmail: user?.email });
    },
  });

  // Resolves to 'ok' | 'failed' | 'skipped' for the button that asked.
  const log = async (oz) => {
    if (add.isPending) return 'skipped';
    // Same cap as the Nutrition page's buttons.
    if (waterOz + pendingOz + oz > WATER_DAILY_CAP_OZ) {
      triggerHaptic('warning');
      setNote({ tone: 'muted', text: tFallback('nutrition.toast.waterCap', "That's plenty of water for today. Stay safe!") });
      return 'skipped';
    }
    setNote(null);
    triggerHaptic('light');
    try {
      await add.mutateAsync(oz);
      return 'ok';
    } catch {
      setNote({ tone: 'error', text: tFallback('bodyMetrics.errors.saveFailed', 'Could not save. Try again.') });
      return 'failed';
    }
  };

  return (
    <div className="flex flex-col gap-6 px-4 pb-4">
      <PanelHeader title={tFallback('quickLog.water', 'Water')} onBack={onBack}
        backLabel={tFallback('common.back', 'Back')} />
      <p className="text-center tabular-nums" aria-live="polite">
        <span className="font-heading text-3xl font-bold">{fmt(Math.round(shownOz))}</span>
        <span className="text-muted-foreground"> / {fmt(waterGoal)} {tFallback('hydration.unit.oz', 'oz')}</span>
        <span className="block text-label text-muted-foreground">{tFallback('quickLog.waterToday', 'Today')}</span>
      </p>
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          {WATER_STEPS_OZ.map((oz) => (
            <WaterStepButton
              key={oz}
              oz={oz}
              label={tFallback('quickLog.addOz', '+{oz} oz', { oz: fmt(oz) })}
              disabled={add.isPending}
              onLog={log}
            />
          ))}
        </div>
        {note && (
          <p
            role={note.tone === 'error' ? 'alert' : 'status'}
            className={`text-sm text-center ${note.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
          >
            {note.text}
          </p>
        )}
        <Button type="button" variant="ghost" className="min-h-12" onClick={() => onDone('/nutrition')}>
          {tFallback('quickLog.openNutrition', 'Open Nutrition')}
        </Button>
      </div>
    </div>
  );
}

export default function QuickLogSheet({ open, onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const [view, setView] = useState('grid');
  const [query, setQuery] = useState('');

  // Every open starts on the grid with an empty search.
  useEffect(() => {
    if (open) { setView('grid'); setQuery(''); }
  }, [open]);

  const go = (to) => {
    triggerHaptic('light');
    navigate(to, { replace: true });
    onClose();
  };

  // Overlays opened by event push their own history entry. Closing this
  // sheet pops ours with history.back(), which lands asynchronously; an
  // overlay opened in the same tick would push first and be popped in our
  // place. So close, then open once the pop has landed.
  const runAfterClose = (fn) => {
    triggerHaptic('light');
    onClose();
    setTimeout(fn, 300);
  };

  const label = (item) => tFallback(item.key, item.en);
  const results = useMemo(() => searchScreens(query, label), [query]); // eslint-disable-line react-hooks/exhaustive-deps
  const searching = query.trim().length > 0;

  return (
    <BottomSheet open={open} onClose={onClose} title={tFallback('quickLog.title', 'Log something')}>
      {view === 'water' && (
        <WaterPanel userProfile={user || {}} onBack={() => setView('grid')} onDone={go} />
      )}
      {view === 'grid' && (
        <div className="flex flex-col gap-6 px-4 pb-4">
          <label className="relative block">
            <span className="sr-only">{tFallback('quickLog.search', 'Search screens')}</span>
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tFallback('quickLog.searchPlaceholder', 'Find a screen')}
              className="h-12 ps-9"
            />
          </label>

          {searching ? (
            results.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center">
                {tFallback('quickLog.noResults', 'Nothing matches that. Try another word.')}
              </p>
            ) : (
              <ul className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
                {results.map((item) => {
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => (item.run ? runAfterClose(item.run) : go(item.to))}
                        className="w-full min-h-12 flex items-center gap-2 px-4 py-3 text-start transition-colors hover:bg-secondary active:bg-secondary"
                      >
                        <Icon className="w-5 h-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="flex-1 min-w-0 text-sm font-medium">{label(item)}</span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {QUICK_LOG_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.inline) { triggerHaptic('light'); setView(item.id); }
                      else go(item.to);
                    }}
                    className="min-h-20 flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card text-sm font-medium transition-colors hover:bg-secondary active:bg-secondary"
                  >
                    <Icon className="w-6 h-6 text-primary" aria-hidden="true" />
                    <span>{label(item)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

// src/pages/Coach.jsx
// Standalone AI Coach route. Two ways in:
//   • /coach            → the conversational AI Coach (advice + plan generation)
//   • /coach?generate=1 → the "Generate Workout" surface: a two-tab view with
//                         the Coach chat AND a tap-only Quick-pick generator, so
//                         users who don't want to type still get a workout.
//
// Both tabs share the same actions: Save a plan to Regimens, or Start a single
// session (handed off to the Workout page via sessionStorage).

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageSquare, SlidersHorizontal } from 'lucide-react';
import CoachChat from '@/components/coach/CoachChat';
import WorkoutQuickGenerator from '@/components/coach/WorkoutQuickGenerator';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '@/api/db';
import * as regimensData from '@/lib/data/regimens';
import { setPendingWorkout } from '@/lib/pendingWorkout';

export default function Coach() {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const generate = !!searchParams.get('generate');

  const [tab, setTab] = useState(0); // 0 = chat, 1 = quick pick

  // A question handed over by another screen: "Assist me" on a goal sends
  // { send, display } here in router state. Read once into state, then the
  // history entry is replaced without it, so a reload or a back-and-forward
  // does not ask the same thing twice (and spend a second daily message).
  const location = useLocation();
  const [initialPrompt] = useState(() => location.state?.coachPrompt || null);
  useEffect(() => {
    if (location.state?.coachPrompt) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The quick generator personalizes on the profile — training goal, diet
  // direction, dietary restrictions and (opt-in) cycle phase. It was mounted
  // without this prop, so it fell back to `{}` and every one of those inputs
  // was silently empty. Same query key the rest of the app uses, so this is
  // served from cache rather than costing an extra fetch.
  const { data: userProfile } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn:  () => db.auth.me(),
    enabled:  !!user?.email,
    staleTime: 60_000,
  });

  // Arriving from a scrolled-down page (e.g. the Workout "Generate Workout"
  // card lives partway down that page) would otherwise land mid-page, with the
  // tabs + welcome scrolled off the top. Snap to the top on mount.
  useEffect(() => { window.scrollTo(0, 0); }, []);

  // Persist a generated plan to the user's Regimens. Payload is already in the
  // regimens shape (from planBuilder / buildStarterRegimen).
  const handleSaveRegimen = useCallback(async (payload) => {
    const row = await regimensData.create(payload);
    queryClient.invalidateQueries({ queryKey: ['regimens', user?.email] });
    return row;
  }, [queryClient, user?.email]);

  // Hand a single session off to the Workout page to log live.
  const handleStartWorkout = useCallback((workout) => {
    setPendingWorkout(workout);
    navigate('/workout');
  }, [navigate]);

  const chat = (
    <ErrorBoundary label="Coach">
      <CoachChat
        mode={generate ? 'generate' : undefined}
        initialPrompt={initialPrompt}
        onSaveRegimen={handleSaveRegimen}
        onStartWorkout={handleStartWorkout}
      />
    </ErrorBoundary>
  );

  if (!generate) {
    return (
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <h1 className="font-heading text-2xl md:text-3xl font-bold tracking-tight mb-4 hidden lg:block">
          {tFallback('hub.coach.title', 'AI Coach')}
        </h1>
        {chat}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <h1 className="font-heading text-2xl md:text-3xl font-bold tracking-tight mb-3 hidden lg:block">
        {tFallback('generator.title', 'Generate Workout')}
      </h1>

      {/* Tabs — tap the segmented control, or swipe the panel. */}
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-secondary/50 p-1">
        <TabButton active={tab === 0} onClick={() => setTab(0)} Icon={MessageSquare}
          label={tFallback('generator.tab.chat', 'Chat')} />
        <TabButton active={tab === 1} onClick={() => setTab(1)} Icon={SlidersHorizontal}
          label={tFallback('generator.tab.quick', 'Quick pick')} />
      </div>

      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: tab === 0 ? -24 : 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: tab === 0 ? 24 : -24 }}
            // 0.1, not the app's usual 0.18: mode="wait" SERIALISES exit and
            // enter, so this number is paid twice — 0.18 meant ~0.36s of dead
            // time after a tap or a swipe on a panel that is drag-driven. The
            // 0.18 elsewhere is on one-shot banner enter/exits, paid once.
            transition={{ duration: 0.1, ease: 'easeOut' }}
            drag="x"
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragEnd={(_e, info) => {
              if (info.offset.x < -60 && tab === 0) setTab(1);
              else if (info.offset.x > 60 && tab === 1) setTab(0);
            }}
          >
            {tab === 0 ? chat : (
              <ErrorBoundary label="QuickGenerator">
                <WorkoutQuickGenerator userProfile={userProfile || {}} onSaveRegimen={handleSaveRegimen} onStartWorkout={handleStartWorkout} />
              </ErrorBoundary>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${
        active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground active:text-foreground'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

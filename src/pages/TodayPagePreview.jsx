// src/pages/TodayPagePreview.jsx
//
// The Today page redesign, three whole-page options side by side for Kegan
// to pick from (Oct 2026). Each is built from real components fed SAMPLE
// data: an intermediate lifter on an upper/lower split, Upper Body Power due
// today, one session done this week, a duel and a crew war running.
//
//   A  Session card   today's session is a card at the top, the carousel under it
//   B  Training hero  the carousel's first slide IS the session, lifts below
//   C  Lead lift      the first lift is the focal figure, everything else below
//
// The stories row, greeting and bottom bar are drawn as stand-ins so the
// first screen has its real height; they are not the components.
//
// Only reachable on a Netlify deploy preview or localhost, never the native
// app (see App.jsx). Writes nothing. `?option=A|B|C` opens one directly.

import React, { useMemo, useState } from 'react';
import { LayoutDashboard, Play, Users, UserCircle } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import HeroPager from '@/components/HeroPager';
import WeekFocal from '@/components/glance/WeekFocal';
import WeekDots from '@/components/glance/WeekDots';
import { renderGlanceSlide } from '@/pages/Dashboard';
import { sampleGlance } from '@/pages/TodayHeroPreview';
import { weekSummary } from '@/lib/focalGoal';
import { liftTrend, heroTrendSlides } from '@/lib/heroTrends';
import { orderHeroSlides } from '@/lib/heroGlance';
import { todaySession } from '@/lib/todaySession';
import {
  SessionCard, SessionLineup, SessionLead, LiftProgress, LogStrip, TodoPeek, StartButton,
} from '@/components/today/TodayTraining';
import { useNumberFormatter } from '@/lib/intl';

const DAY_MS = 86_400_000;
const iso = (now, offset) => {
  const d = new Date(now.getTime() + offset * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const UPPER = {
  name: 'Upper Body Power Day',
  exercises: [
    { name: 'Bench Press', target_sets: 4, target_reps: 5 },
    { name: 'Overhead Press', target_sets: 3, target_reps: 6 },
    { name: 'Barbell Row', target_sets: 4, target_reps: 6 },
    { name: 'Pull-Up', target_sets: 3, target_reps: 8 },
    { name: 'Incline Dumbbell Press', target_sets: 3, target_reps: 10 },
    { name: 'Tricep Pushdown', target_sets: 3, target_reps: 12 },
  ],
};

// Seven weekly upper sessions, newest last, and a lower day this Wednesday.
function sampleLogs(now) {
  const W = [-49, -42, -35, -28, -21, -14, -7];
  const prog = (from, to, i) => Math.round((from + ((to - from) * i) / (W.length - 1)) / 5) * 5;
  const logs = W.map((o, i) => ({
    id: `u${o}`,
    date: iso(now, o),
    created_at: `${iso(now, o)}T18:${String(10 + i * 5).padStart(2, '0')}:00`,
    workout_name: UPPER.name,
    exercises: [
      { name: 'Bench Press', sets: [{ weight: prog(170, 190, i), reps: 5 }, { weight: prog(170, 190, i), reps: 5 }] },
      { name: 'Overhead Press', sets: [{ weight: prog(100, 115, i), reps: 6 }, { weight: prog(100, 115, i), reps: 4, is_failed: i === 6 }] },
      { name: 'Barbell Row', sets: [{ weight: prog(140, 160, i), reps: 6 }] },
      { name: 'Pull-Up', sets: [{ weight: 0, reps: 8 }] },
      { name: 'Incline Dumbbell Press', sets: [{ weight: prog(45, 60, i), reps: 10 }] },
      { name: 'Tricep Pushdown', sets: [{ weight: prog(40, 50, i), reps: 12 }] },
    ],
  }));
  logs.push({
    id: 'l-2', date: iso(now, -2), created_at: `${iso(now, -2)}T18:20:00`, workout_name: 'Lower Body Day',
    exercises: [{ name: 'Squat', sets: [{ weight: 225, reps: 5 }] }],
  });
  return logs.reverse(); // newest first, as the app fetches them
}

function Stories() {
  const people = ['KE', 'CK', 'N', 'TR', 'A', 'B', 'T'];
  return (
    <div className="flex gap-3 overflow-hidden py-2" aria-hidden="true">
      {people.map((p, i) => (
        <div key={i} className="flex flex-col items-center gap-1 shrink-0">
          <span className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-label font-semibold text-muted-foreground">{p}</span>
          <span className="w-10 h-1.5 rounded-full bg-secondary" />
        </div>
      ))}
    </div>
  );
}

function Greeting() {
  return (
    <div className="mt-2">
      <p className="kicker mb-1.5">Friday, October 2</p>
      <h1 className="font-display text-3xl">
        <span className="text-muted-foreground/80">Rise and grind, </span>
        <span className="text-foreground">Kegan</span>
        <span className="text-primary">.</span>
      </h1>
    </div>
  );
}

function NavBar() {
  const items = [[LayoutDashboard, 'Today', true], [Play, 'Train'], [Users, 'Hub'], [UserCircle, 'You']];
  return (
    <nav className="fixed bottom-0 inset-x-0 bg-card border-t border-border px-4 pt-1 pb-6 flex justify-around" aria-hidden="true">
      {items.map(([Icon, label, on]) => (
        <span key={label} className={`flex flex-col items-center gap-0.5 py-1.5 ${on ? 'text-primary' : 'text-muted-foreground'}`}>
          <Icon className="w-6 h-6" strokeWidth={1.75} />
          <span className="text-micro">{label}</span>
        </span>
      ))}
    </nav>
  );
}

function Carousel({ slides, week }) {
  return (
    <div style={{ touchAction: 'pan-y' }}>
      <HeroPager
        slides={slides}
        wrap
        autoRotate={false}
        dotsClassName="justify-center mt-2.5"
        renderSlide={(slide, { isActive }) => (
          slide.id === 'week'
            ? <WeekFocal week={week} />
            : slide.id === 'session'
              ? slide.render()
              : renderGlanceSlide(slide, isActive)
        )}
      />
    </div>
  );
}

const OPTIONS = [
  ['A', 'A  Session card'],
  ['B', 'B  Training hero'],
  ['C', 'C  Lead lift'],
];

export default function TodayPagePreview() {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const initial = (() => {
    try { return new URLSearchParams(window.location.search).get('option') || 'A'; } catch { return 'A'; }
  })();
  const [option, setOption] = useState(initial);
  const bare = (() => { try { return new URLSearchParams(window.location.search).has('bare'); } catch { return false; } })();

  const now = useMemo(() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; }, []);
  const logs = useMemo(() => sampleLogs(now), [now]);
  const week = useMemo(() => weekSummary({ logs, profile: { training_days: [1, 3, 5] }, now }), [logs, now]);
  const session = useMemo(() => todaySession(UPPER, logs, { now }), [logs, now]);
  const glance = useMemo(() => {
    const g = sampleGlance(logs, now);
    // Quests live in the To do row on every option, so not in the carousel too.
    return { ...g, quests: null };
  }, [logs, now]);
  const lifts = useMemo(
    () => session.lifts.map((l) => liftTrend(logs, l.name, now)).filter((t) => t.ready && t.last?.v > 0).slice(0, 3),
    [session, logs, now],
  );
  const others = useMemo(() => orderHeroSlides({ ...glance, trends: [] }), [glance]);
  const withTrends = useMemo(
    () => orderHeroSlides({ ...glance, trends: heroTrendSlides({ logs, bodyMetrics: [], now }) }),
    [glance, logs, now],
  );

  const logItems = [
    { id: 'meals', share: 1 / 3, value: '1/3' },
    { id: 'water', share: 4 / 12, value: '4/12' },
    { id: 'sleep', share: 1, value: '7h 20' },
    { id: 'mood', share: 0 },
    { id: 'steps', share: 3240 / 8000, value: fmt(3240) },
  ];
  const startLabel = tFallback('dashboard.hero.cta.startPlan', 'Start {name}', { name: session.name });
  const upNext = tFallback('dashboard.hero.label.upNext', 'Up next');
  const sessionDetail = tFallback('today.session.detail', '{lifts} lifts, about {min} min', {
    lifts: fmt(session.lifts.length), min: fmt(session.minutes),
  });

  // The page's one 32px break, between acting (above) and state (below).
  // It sits between two fluid gaps, so it subtracts them back out.
  const seam = <div aria-hidden="true" style={{ marginTop: 'calc(32px - 2 * var(--fluid-section))' }} />;
  const gap = { gap: 'var(--fluid-section)' };

  let page;
  if (option === 'A') {
    page = (
      <div className="flex flex-col" style={gap}>
        <SessionCard session={session} onStart={() => {}} />
        <Carousel slides={[{ id: 'week' }, ...withTrends]} week={week} />
        {seam}
        <LogStrip items={logItems} />
        <TodoPeek done={1} total={4} xp={20} />
      </div>
    );
  } else if (option === 'B') {
    const first = {
      id: 'session',
      render: () => (
        <WeekFocal
          week={week}
          headline={session.name}
          detail={sessionDetail}
          visual={<SessionLineup session={session} />}
        />
      ),
    };
    page = (
      <div className="flex flex-col" style={gap}>
        <Carousel slides={[first, ...others]} week={week} />
        <StartButton label={startLabel} kicker={upNext} onStart={() => {}} />
        {seam}
        <LiftProgress trends={lifts} />
        <LogStrip items={logItems} />
        <TodoPeek done={1} total={4} xp={20} />
      </div>
    );
  } else {
    page = (
      <div className="flex flex-col" style={gap}>
        <SessionLead session={session} weekShare={week.target ? week.done / week.target : null} weekLabel={tFallback('today.week.count', '{done} of {target} this week', { done: fmt(week.done), target: fmt(week.target) })} />
        <StartButton label={startLabel} kicker={sessionDetail} onStart={() => {}} />
        <div className="flex flex-col gap-2">
          <p className="kicker">{tFallback('today.week.count', '{done} of {target} this week', { done: fmt(week.done), target: fmt(week.target) })}</p>
          <WeekDots days={week.days} />
        </div>
        {seam}
        <LiftProgress trends={lifts} />
        <Carousel slides={others} week={week} />
        <LogStrip items={logItems} />
        <TodoPeek done={1} total={4} xp={20} />
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {!bare && (
        <div className="px-4 pt-4 flex flex-wrap items-center gap-2">
          <p className="text-label font-medium text-muted-foreground w-full">Proposal, sample data</p>
          {OPTIONS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setOption(key)}
              className={`h-9 px-3 rounded-lg border text-label ${option === key ? 'border-primary text-foreground' : 'border-border text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="px-4 pt-1 pb-32 max-w-5xl mx-auto" key={option}>
        <Stories />
        <Greeting />
        <div className="mt-5">{page}</div>
      </div>
      <NavBar />
    </div>
  );
}
